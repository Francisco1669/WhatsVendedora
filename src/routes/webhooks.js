const express = require("express");
const env = require("../config/env");
const {
    getInstanceById,
    getInstanceByEvolutionInstance,
    setInstanceStatus,
    setInstanceLatestQr,
    saveInboundMessage,
} = require("../db/database");
const logger = require("../lib/logger");
const {
    extractEventName,
    extractPayloadInstanceName,
    normalizeInboundPayload,
    isMessageEvent,
    extractConnectionStatus,
} = require("../services/origin-resolver");
const asyncHandler = require("../utils/async-handler");

const router = express.Router();

function extractIncomingToken(req) {
    const authHeader = req.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
        return authHeader.slice(7).trim();
    }

    return (
        req.get("x-webhook-token") ||
        req.get("x-evolution-token") ||
        req.get("apikey") ||
        req.body?.apikey ||
        req.query.token ||
        null
    );
}

function assertWebhookAuthorized(req, instanceRecord) {
    const allowedTokens = [
        instanceRecord.webhookToken,
        env.EVOLUTION_GLOBAL_WEBHOOK_SECRET,
        env.EVOLUTION_API_KEY,
    ].filter(Boolean);

    if (allowedTokens.length === 0) {
        return;
    }

    const incomingToken = extractIncomingToken(req);
    if (!incomingToken || !allowedTokens.includes(incomingToken)) {
        const error = new Error("Webhook nao autorizado para esta instancia.");
        error.status = 401;
        throw error;
    }
}

function resolveWebhookInstance(req) {
    if (req.params.instanceId) {
        return {
            instance: getInstanceById(req.params.instanceId),
            routeInstanceId: req.params.instanceId,
            resolvedBy: "route",
        };
    }

    const evolutionInstance = extractPayloadInstanceName(req.body) || req.get("x-evolution-instance");
    if (!evolutionInstance) {
        const error = new Error(
            "Webhook global sem identificador da instancia. Envie instance/instanceName no payload ou use /webhooks/evolution/:instanceId."
        );
        error.status = 400;
        throw error;
    }

    const instance = getInstanceByEvolutionInstance(evolutionInstance);
    return {
        instance,
        routeInstanceId: instance?.id || evolutionInstance,
        resolvedBy: "payload",
    };
}

async function handleEvolutionWebhook(req, res) {
    const { instance, routeInstanceId, resolvedBy } = resolveWebhookInstance(req);

    if (!instance || !instance.active) {
        res.status(404).json({ error: "Instancia nao encontrada ou inativa." });
        return;
    }

    assertWebhookAuthorized(req, instance);

    const eventName = extractEventName(req.body);
    const detectedStatus = extractConnectionStatus(req.body, eventName);
    if (detectedStatus) {
        setInstanceStatus(instance.id, detectedStatus);
    }

    if ((eventName || "").toUpperCase().includes("QRCODE")) {
        setInstanceLatestQr(instance.id, req.body);
    }

    if (!isMessageEvent(eventName)) {
        res.status(202).json({
            ok: true,
            stored: false,
            instanceId: instance.id,
            originTag: `${instance.id}:${instance.phoneNumber}`,
            eventName,
            resolvedBy,
        });
        return;
    }

    const normalized = normalizeInboundPayload({
        payload: req.body,
        instanceRecord: instance,
        routeInstanceId,
        headerInstanceName: req.get("x-evolution-instance"),
    });

    const saveResult = saveInboundMessage(normalized);

    logger.info(
        {
            instanceId: normalized.instanceId,
            originTag: normalized.originTag,
            evolutionMessageId: normalized.evolutionMessageId,
            stored: saveResult.inserted,
        },
        "Webhook processed"
    );

    res.status(202).json({
        ok: true,
        stored: saveResult.inserted,
        deduplicated: !saveResult.inserted,
        instanceId: normalized.instanceId,
        originTag: normalized.originTag,
        eventName: normalized.eventName,
        resolvedBy,
    });
}

router.post("/webhooks/evolution", asyncHandler(handleEvolutionWebhook));
router.post("/webhooks/evolution/:instanceId", asyncHandler(handleEvolutionWebhook));

module.exports = router;
