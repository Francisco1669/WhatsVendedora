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
} = require("./origin-resolver");
const { uploadBase64Media } = require("./s3-storage");

function getHeader(headers, name) {
    const loweredName = String(name).toLowerCase();
    return headers?.[loweredName] || headers?.[name] || null;
}

function extractIncomingToken(jobData) {
    const headers = jobData.headers || {};
    const authHeader = getHeader(headers, "authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
        return authHeader.slice(7).trim();
    }

    return (
        getHeader(headers, "x-webhook-token") ||
        getHeader(headers, "x-evolution-token") ||
        getHeader(headers, "apikey") ||
        jobData.body?.apikey ||
        jobData.query?.token ||
        null
    );
}

function assertWebhookAuthorized(jobData, instanceRecord) {
    const allowedTokens = [
        instanceRecord.webhookToken,
        env.EVOLUTION_GLOBAL_WEBHOOK_SECRET,
        env.EVOLUTION_API_KEY,
    ].filter(Boolean);

    if (allowedTokens.length === 0) {
        return;
    }

    const incomingToken = extractIncomingToken(jobData);
    if (!incomingToken || !allowedTokens.includes(incomingToken)) {
        const error = new Error("Webhook nao autorizado para esta instancia.");
        error.status = 401;
        throw error;
    }
}

async function offloadMediaToS3(payload) {
    if (!payload?.data) return payload;

    const data = payload.data;
    const mediaObj = Array.isArray(data) ? data[0] : (data.messages && data.messages[0]) || data;

    const base64Data = mediaObj?.message?.base64 || mediaObj?.base64;
    const mimeType = mediaObj?.message?.mimetype || mediaObj?.mimetype;

    if (base64Data && typeof base64Data === "string" && base64Data.length > 500) {
        try {
            // Some base64 strings come with data:mimetype;base64, prefix. Remove it if present.
            const cleanBase64 = base64Data.replace(/^data:.*?;base64,/, "");
            const s3Url = await uploadBase64Media(cleanBase64, mimeType);
            
            if (s3Url) {
                if (mediaObj.message && mediaObj.message.base64) {
                    delete mediaObj.message.base64;
                    mediaObj.message.s3Url = s3Url;
                }
                if (mediaObj.base64) {
                    delete mediaObj.base64;
                    mediaObj.s3Url = s3Url;
                }
                logger.info({ s3Url }, "Media offloaded to S3 successfully");
            }
        } catch (err) {
            logger.warn({ err }, "Could not offload base64 media to S3. Retaining original.");
        }
    }
    
    return payload;
}

async function resolveWebhookInstance(jobData) {
    if (jobData.params?.instanceId) {
        return {
            instance: await getInstanceById(jobData.params.instanceId),
            routeInstanceId: jobData.params.instanceId,
            resolvedBy: "route",
        };
    }

    const evolutionInstance =
        extractPayloadInstanceName(jobData.body) || getHeader(jobData.headers, "x-evolution-instance");
    if (!evolutionInstance) {
        const error = new Error(
            "Webhook global sem identificador da instancia. Envie instance/instanceName no payload ou use /webhooks/evolution/:instanceId."
        );
        error.status = 400;
        throw error;
    }

    const instance = await getInstanceByEvolutionInstance(evolutionInstance);
    return {
        instance,
        routeInstanceId: instance?.id || evolutionInstance,
        resolvedBy: "payload",
    };
}

async function processEvolutionWebhookJob(jobData) {
    const { instance, routeInstanceId, resolvedBy } = await resolveWebhookInstance(jobData);

    if (!instance || !instance.active) {
        const error = new Error("Instancia nao encontrada ou inativa.");
        error.status = 404;
        throw error;
    }

    assertWebhookAuthorized(jobData, instance);

    const eventName = extractEventName(jobData.body);
    const detectedStatus = extractConnectionStatus(jobData.body, eventName);
    if (detectedStatus) {
        await setInstanceStatus(instance.id, detectedStatus);
    }

    if ((eventName || "").toUpperCase().includes("QRCODE")) {
        await setInstanceLatestQr(instance.id, jobData.body);
    }

    if (!isMessageEvent(eventName)) {
        return {
            ok: true,
            stored: false,
            instanceId: instance.id,
            originTag: `${instance.id}:${instance.phoneNumber}`,
            eventName,
            resolvedBy,
        };
    }

    await offloadMediaToS3(jobData.body);

    const normalized = normalizeInboundPayload({
        payload: jobData.body,
        instanceRecord: instance,
        routeInstanceId,
        headerInstanceName: getHeader(jobData.headers, "x-evolution-instance"),
    });

    const saveResult = await saveInboundMessage(normalized);

    logger.info(
        {
            instanceId: normalized.instanceId,
            originTag: normalized.originTag,
            evolutionMessageId: normalized.evolutionMessageId,
            stored: saveResult.inserted,
        },
        "Webhook processed"
    );

    return {
        ok: true,
        stored: saveResult.inserted,
        deduplicated: !saveResult.inserted,
        instanceId: normalized.instanceId,
        originTag: normalized.originTag,
        eventName: normalized.eventName,
        resolvedBy,
    };
}

module.exports = {
    processEvolutionWebhookJob,
};
