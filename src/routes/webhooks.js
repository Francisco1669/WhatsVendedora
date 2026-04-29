const express = require("express");
const { enqueueEvolutionWebhook } = require("../services/queue");
const { extractEventName } = require("../services/origin-resolver");
const asyncHandler = require("../utils/async-handler");

const router = express.Router();

function pickWebhookHeaders(req) {
    return {
        authorization: req.get("authorization") || null,
        "x-webhook-token": req.get("x-webhook-token") || null,
        "x-evolution-token": req.get("x-evolution-token") || null,
        "x-evolution-instance": req.get("x-evolution-instance") || null,
        apikey: req.get("apikey") || null,
        "user-agent": req.get("user-agent") || null,
    };
}

async function handleEvolutionWebhook(req, res) {
    const eventName = extractEventName(req.body);
    const requestId = req.get("x-request-id") || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const job = await enqueueEvolutionWebhook({
        requestId,
        receivedAt: new Date().toISOString(),
        path: req.originalUrl,
        ip: req.ip,
        params: {
            instanceId: req.params.instanceId || null,
        },
        query: req.query || {},
        headers: pickWebhookHeaders(req),
        body: req.body || {},
    });

    res.status(200).json({
        ok: true,
        queued: true,
        jobId: job.id,
        eventName,
    });
}

router.post("/webhooks/evolution", asyncHandler(handleEvolutionWebhook));
router.post("/webhooks/evolution/:instanceId", asyncHandler(handleEvolutionWebhook));

module.exports = router;
