const { createHash } = require("crypto");

function pickString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return null;
}

function extractEventName(payload) {
    return (
        pickString(payload?.event, payload?.type, payload?.eventType, payload?.data?.event) || "unknown"
    );
}

function extractEnvelope(payload) {
    const dataNode = payload?.data;

    if (Array.isArray(dataNode)) {
        return dataNode[0] || {};
    }

    if (dataNode && typeof dataNode === "object") {
        if (Array.isArray(dataNode.messages)) {
            return dataNode.messages[0] || dataNode;
        }

        if (dataNode.messages && typeof dataNode.messages === "object") {
            return dataNode.messages;
        }

        return dataNode;
    }

    return payload || {};
}

function extractTextBody(messageObject) {
    return (
        pickString(
            messageObject?.conversation,
            messageObject?.extendedTextMessage?.text,
            messageObject?.imageMessage?.caption,
            messageObject?.videoMessage?.caption,
            messageObject?.templateButtonReplyMessage?.selectedDisplayText,
            messageObject?.buttonsResponseMessage?.selectedDisplayText,
            messageObject?.listResponseMessage?.title
        ) || ""
    );
}

function extractMessageType(messageObject) {
    const keys = Object.keys(messageObject || {});
    return keys.length > 0 ? keys[0] : "unknown";
}

function extractPayloadInstanceName(payload) {
    const envelope = extractEnvelope(payload);

    return pickString(
        payload?.instance,
        payload?.instanceName,
        payload?.sender,
        payload?.data?.instance,
        payload?.data?.instanceName,
        envelope?.instance,
        envelope?.instanceName
    );
}

function normalizeInboundPayload({ payload, instanceRecord, routeInstanceId, headerInstanceName }) {
    if (!instanceRecord) {
        const error = new Error("Instancia nao encontrada.");
        error.status = 404;
        throw error;
    }

    if (routeInstanceId !== instanceRecord.id) {
        const error = new Error("Instancia da rota nao corresponde ao cadastro local.");
        error.status = 409;
        throw error;
    }

    const payloadInstanceName = extractPayloadInstanceName(payload);
    if (payloadInstanceName && payloadInstanceName !== instanceRecord.evolutionInstance) {
        const error = new Error("Evento recebido com instanceName diferente do esperado.");
        error.status = 409;
        throw error;
    }

    if (headerInstanceName && headerInstanceName !== instanceRecord.evolutionInstance) {
        const error = new Error("Cabecalho x-evolution-instance nao confere com a instancia registrada.");
        error.status = 409;
        throw error;
    }

    const envelope = extractEnvelope(payload);
    const key = envelope?.key || payload?.key || {};
    const messageObject = envelope?.message || payload?.message || {};

    const eventName = extractEventName(payload);
    const chatJid = pickString(
        key?.remoteJid,
        envelope?.remoteJid,
        envelope?.chatJid,
        payload?.remoteJid
    );
    const fromJid = pickString(
        key?.participant,
        key?.remoteJid,
        envelope?.participant,
        envelope?.sender,
        payload?.sender
    );
    const fromMe = Boolean(key?.fromMe || envelope?.fromMe || payload?.fromMe);
    const toJid = fromMe ? chatJid : instanceRecord.phoneNumber;

    const messageType = extractMessageType(messageObject);
    const textBody = extractTextBody(messageObject);
    const extractedMessageId = pickString(key?.id, envelope?.id, payload?.id);

    const fallbackFingerprint = JSON.stringify({
        instanceId: instanceRecord.id,
        eventName,
        chatJid,
        fromJid,
        fromMe,
        messageType,
        textBody,
        timestamp: pickString(
            String(envelope?.messageTimestamp || ""),
            String(envelope?.timestamp || ""),
            String(payload?.date_time || "")
        ),
    });
    const evolutionMessageId =
        extractedMessageId || createHash("sha1").update(fallbackFingerprint).digest("hex");

    return {
        evolutionMessageId,
        instanceId: instanceRecord.id,
        originTag: `${instanceRecord.id}:${instanceRecord.phoneNumber}`,
        originPhone: instanceRecord.phoneNumber,
        eventName,
        chatJid,
        fromJid,
        toJid,
        fromMe: fromMe ? 1 : 0,
        messageType,
        textBody,
        rawPayload: JSON.stringify(payload || {}),
    };
}

function isMessageEvent(eventName) {
    return (eventName || "").toUpperCase().includes("MESSAGE");
}

function extractConnectionStatus(payload, eventName) {
    const upperEvent = (eventName || "").toUpperCase();
    if (!upperEvent.includes("CONNECTION") && !upperEvent.includes("QRCODE")) {
        return null;
    }

    return pickString(
        payload?.data?.state,
        payload?.data?.connection,
        payload?.data?.status,
        payload?.state,
        payload?.status,
        payload?.connection
    );
}

module.exports = {
    extractEventName,
    normalizeInboundPayload,
    isMessageEvent,
    extractConnectionStatus,
};
