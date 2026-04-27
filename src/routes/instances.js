const { randomBytes } = require("crypto");
const express = require("express");
const env = require("../config/env");
const {
    upsertInstance,
    listInstances,
    getInstanceById,
    listInboundMessages,
    listInstanceConversations,
    saveOutboundMessage,
    deleteInstancePermanently,
    recordAdminAudit,
} = require("../db/database");
const evolutionClient = require("../services/evolution-client");
const asyncHandler = require("../utils/async-handler");
const {
    instancePayloadSchema,
    instanceUpdatePayloadSchema,
    sendMessageSchema,
    instanceMessagesQuerySchema,
} = require("../validation/schemas");

const router = express.Router();

function buildWebhookBaseUrl(req) {
    if (env.PUBLIC_WEBHOOK_BASE_URL) {
        return env.PUBLIC_WEBHOOK_BASE_URL
            .replace(/\/+$/, "")
            .replace(/\/webhooks\/evolution$/i, "");
    }

    return `${req.protocol}://${req.get("host")}`;
}

function sanitizeInstance(instance, options = {}) {
    return {
        id: instance.id,
        label: instance.label,
        phoneNumber: instance.phoneNumber,
        evolutionInstance: instance.evolutionInstance,
        active: Boolean(instance.active),
        status: instance.status,
        lastQrPayload: instance.lastQrPayload,
        lastQrAt: instance.lastQrAt,
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
        webhookToken: options.includeWebhookToken ? instance.webhookToken : undefined,
    };
}

function hasUsefulQrData(qrData) {
    if (!qrData) {
        return false;
    }

    if (typeof qrData === "string") {
        return qrData.trim().length > 0;
    }

    if (typeof qrData !== "object") {
        return false;
    }

    const candidates = [
        qrData.base64,
        qrData.qr,
        qrData.qrcode,
        qrData.qrCode,
        qrData.code,
        qrData.pairingCode,
        qrData?.data?.base64,
        qrData?.data?.qr,
        qrData?.data?.qrcode,
        qrData?.data?.qrCode,
        qrData?.data?.code,
        qrData?.data?.pairingCode,
    ];

    return candidates.some((value) => typeof value === "string" && value.trim().length > 0);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProfileNumber(item) {
    if (item.contactPhone) {
        return item.contactPhone;
    }

    if (item.contactJid && !item.contactJid.includes("@lid")) {
        return item.contactJid;
    }

    return null;
}

async function tryFetchProfilePicture(instanceName, number) {
    if (!number || !evolutionClient.isConfigured()) {
        return null;
    }

    try {
        const profile = await evolutionClient.fetchProfilePictureUrl(instanceName, number);
        return profile?.profilePictureUrl || null;
    } catch (error) {
        return null;
    }
}

async function tryFetchGroupInfo(instanceName, groupJid) {
    if (!groupJid || !evolutionClient.isConfigured()) {
        return null;
    }

    try {
        return await evolutionClient.fetchGroupInfo(instanceName, groupJid);
    } catch (error) {
        return null;
    }
}

async function enrichConversation(instance, conversation) {
    if (conversation.isGroup) {
        const groupInfo = await tryFetchGroupInfo(instance.evolutionInstance, conversation.conversationId);
        const groupAvatarUrl =
            groupInfo?.pictureUrl ||
            (await tryFetchProfilePicture(instance.evolutionInstance, conversation.conversationId));

        return {
            ...conversation,
            groupName: groupInfo?.subject || null,
            groupAvatarUrl,
            avatarUrl: groupAvatarUrl,
            displayName: groupInfo?.subject || "Grupo sem nome",
            participantDisplay: conversation.contactDisplay,
            participantAvatarUrl: await tryFetchProfilePicture(
                instance.evolutionInstance,
                getProfileNumber(conversation)
            ),
        };
    }

    const avatarUrl = await tryFetchProfilePicture(instance.evolutionInstance, getProfileNumber(conversation));
    return {
        ...conversation,
        avatarUrl,
        displayName: conversation.contactDisplay,
    };
}

async function enrichMessage(instance, message, groupCache = new Map(), avatarCache = new Map()) {
    let chatAvatarUrl = null;
    let groupName = null;

    if (message.isGroup) {
        if (!groupCache.has(message.conversationId)) {
            groupCache.set(
                message.conversationId,
                await tryFetchGroupInfo(instance.evolutionInstance, message.conversationId)
            );
        }

        const groupInfo = groupCache.get(message.conversationId);
        groupName = groupInfo?.subject || null;
        chatAvatarUrl =
            groupInfo?.pictureUrl ||
            (await tryFetchProfilePicture(instance.evolutionInstance, message.conversationId));
    }

    const profileNumber = getProfileNumber(message);
    if (profileNumber && !avatarCache.has(profileNumber)) {
        avatarCache.set(
            profileNumber,
            await tryFetchProfilePicture(instance.evolutionInstance, profileNumber)
        );
    }

    const senderAvatarUrl = profileNumber ? avatarCache.get(profileNumber) : null;

    return {
        ...message,
        groupName,
        chatAvatarUrl,
        senderAvatarUrl,
        avatarUrl: message.isGroup ? senderAvatarUrl || chatAvatarUrl : senderAvatarUrl,
        displayName: message.isGroup ? message.contactDisplay : message.contactDisplay,
    };
}

router.post(
    "/instances",
    asyncHandler(async (req, res) => {
        const payload = instancePayloadSchema.parse(req.body || {});
        const webhookToken = payload.webhookToken || randomBytes(24).toString("hex");

        const saved = upsertInstance({
            ...payload,
            webhookToken,
        });

        const shouldProvision = req.query.provision !== "false";
        const webhookUrl = `${buildWebhookBaseUrl(req)}/webhooks/evolution/${saved.id}`;

        let integration = {
            provisioned: false,
            webhookUrl,
            warnings: [],
        };

        if (shouldProvision) {
            try {
                await evolutionClient.provisionInstance({
                    instanceName: saved.evolutionInstance,
                    webhookUrl,
                    webhookToken,
                });
                integration.provisioned = true;
            } catch (error) {
                integration.warnings.push(error.message);
            }
        }

        recordAdminAudit({
            adminUserId: req.auth?.user?.id || null,
            action: "INSTANCE_UPSERT",
            instanceId: saved.id,
            metadata: {
                provisionRequested: shouldProvision,
                provisioned: integration.provisioned,
                warnings: integration.warnings,
            },
        });

        res.status(201).json({
            data: sanitizeInstance(saved, { includeWebhookToken: true }),
            integration,
        });
    })
);

router.patch(
    "/instances/:instanceId",
    asyncHandler(async (req, res) => {
        const existing = getInstanceById(req.params.instanceId);
        if (!existing) {
            res.status(404).json({ error: "Instancia nao encontrada." });
            return;
        }

        const payload = instanceUpdatePayloadSchema.parse(req.body || {});

        const saved = upsertInstance({
            id: existing.id,
            label: payload.label ?? existing.label,
            phoneNumber: payload.phoneNumber ?? existing.phoneNumber,
            evolutionInstance: payload.evolutionInstance ?? existing.evolutionInstance,
            webhookToken: payload.webhookToken ?? existing.webhookToken,
            active: payload.active ?? Boolean(existing.active),
            status: payload.status ?? existing.status,
        });

        recordAdminAudit({
            adminUserId: req.auth?.user?.id || null,
            action: "INSTANCE_UPDATE",
            instanceId: saved.id,
            metadata: {
                changedFields: Object.keys(payload),
            },
        });

        res.json({
            data: sanitizeInstance(saved, { includeWebhookToken: true }),
        });
    })
);

router.delete(
    "/instances/:instanceId",
    asyncHandler(async (req, res) => {
        const existing = getInstanceById(req.params.instanceId);
        if (!existing) {
            res.status(404).json({ error: "Instancia nao encontrada." });
            return;
        }

        const deleted = deleteInstancePermanently(existing.id);

        recordAdminAudit({
            adminUserId: req.auth?.user?.id || null,
            action: "INSTANCE_DELETE",
            instanceId: null,
            metadata: {
                deletedInstanceId: existing.id,
                deletedLabel: existing.label,
                deletedCounts: deleted,
            },
        });

        res.json({
            message: "Instancia excluida permanentemente.",
            data: {
                id: existing.id,
                label: existing.label,
            },
            deleted,
        });
    })
);

router.post(
    "/instances/:instanceId/deactivate",
    asyncHandler(async (req, res) => {
        const existing = getInstanceById(req.params.instanceId);
        if (!existing) {
            res.status(404).json({ error: "Instancia nao encontrada." });
            return;
        }

        const saved = upsertInstance({
            id: existing.id,
            label: existing.label,
            phoneNumber: existing.phoneNumber,
            evolutionInstance: existing.evolutionInstance,
            webhookToken: existing.webhookToken,
            active: false,
            status: "inactive",
        });

        recordAdminAudit({
            adminUserId: req.auth?.user?.id || null,
            action: "INSTANCE_DEACTIVATE",
            instanceId: saved.id,
            metadata: {
                previousStatus: existing.status,
                previousActive: Boolean(existing.active),
            },
        });

        res.json({
            message: "Instancia desativada com sucesso.",
            data: sanitizeInstance(saved),
        });
    })
);

router.get(
    "/instances",
    asyncHandler(async (req, res) => {
        const includeState = req.query.includeState === "true";
        const instances = listInstances().map((item) => sanitizeInstance(item));

        if (includeState && evolutionClient.isConfigured()) {
            await Promise.all(
                instances.map(async (instance) => {
                    try {
                        instance.liveConnection = await evolutionClient.fetchConnectionState(
                            instance.evolutionInstance
                        );
                    } catch (error) {
                        instance.liveConnection = {
                            error: "Nao foi possivel consultar estado remoto.",
                            detail: error.message,
                        };
                    }
                })
            );
        }

        res.json({
            total: instances.length,
            data: instances,
        });
    })
);

router.post(
    "/instances/:instanceId/connect",
    asyncHandler(async (req, res) => {
        const instance = getInstanceById(req.params.instanceId);
        if (!instance || !instance.active) {
            res.status(404).json({ error: "Instancia nao encontrada ou inativa." });
            return;
        }

        let qrData = await evolutionClient.requestConnectionQr(instance.evolutionInstance);

        if (!hasUsefulQrData(qrData)) {
            for (let attempt = 0; attempt < 6; attempt += 1) {
                await wait(2000);
                const refreshedInstance = getInstanceById(instance.id);
                if (hasUsefulQrData(refreshedInstance?.lastQrPayload)) {
                    qrData = refreshedInstance.lastQrPayload;
                    break;
                }
            }
        }

        res.json({
            data: {
                instanceId: instance.id,
                originTag: `${instance.id}:${instance.phoneNumber}`,
                qrData,
            },
        });
    })
);

router.post(
    "/instances/:instanceId/send",
    asyncHandler(async (req, res) => {
        const parsedBody = sendMessageSchema.parse(req.body || {});
        const instance = getInstanceById(req.params.instanceId);

        if (!instance || !instance.active) {
            res.status(404).json({ error: "Instancia nao encontrada ou inativa." });
            return;
        }

        const sendResult = await evolutionClient.sendTextMessage({
            instanceName: instance.evolutionInstance,
            to: parsedBody.to,
            text: parsedBody.text,
        });

        const sender = req.auth?.user || null;

        saveOutboundMessage({
            instanceId: instance.id,
            originTag: `${instance.id}:${instance.phoneNumber}`,
            toJid: parsedBody.to,
            textBody: parsedBody.text,
            responsePayload: JSON.stringify(sendResult || {}),
            sentByUserId: sender?.id || null,
            sentByUserName: sender?.name || null,
            sentByUserRole: sender?.role || null,
            requestId: req.get("x-request-id") || null,
        });

        recordAdminAudit({
            adminUserId: sender?.id || null,
            action: "MESSAGE_SEND",
            instanceId: instance.id,
            targetJid: parsedBody.to,
            metadata: {
                originTag: `${instance.id}:${instance.phoneNumber}`,
                textPreview: parsedBody.text.slice(0, 160),
            },
        });

        res.status(202).json({
            data: {
                instanceId: instance.id,
                originTag: `${instance.id}:${instance.phoneNumber}`,
                sentTo: parsedBody.to,
            },
        });
    })
);

router.get(
    "/instances/:instanceId/conversations",
    asyncHandler(async (req, res) => {
        const instance = getInstanceById(req.params.instanceId);
        if (!instance) {
            res.status(404).json({ error: "Instancia nao encontrada." });
            return;
        }

        const query = instanceMessagesQuerySchema.parse(req.query || {});
        const conversations = listInstanceConversations({
            instanceId: instance.id,
            receivedAfter: query.receivedAfter,
        });
        const data = await Promise.all(
            conversations.slice(0, 80).map((conversation) => enrichConversation(instance, conversation))
        );

        res.json({
            instanceId: instance.id,
            originTag: `${instance.id}:${instance.phoneNumber}`,
            count: data.length,
            data,
        });
    })
);

router.get(
    "/instances/:instanceId/messages",
    asyncHandler(async (req, res) => {
        const instance = getInstanceById(req.params.instanceId);
        if (!instance) {
            res.status(404).json({ error: "Instancia nao encontrada." });
            return;
        }

        const query = instanceMessagesQuerySchema.parse(req.query || {});
        const limit = Math.min(
            Number(query.limit || env.DEFAULT_PAGE_SIZE),
            Number(env.MAX_PAGE_SIZE || 200)
        );
        const offset = Math.max(0, Number(query.offset || 0));

        const messages = listInboundMessages({
            instanceId: instance.id,
            conversationId: query.conversationId,
            receivedAfter: query.receivedAfter,
            limit,
            offset,
        });
        const groupCache = new Map();
        const avatarCache = new Map();
        const data = await Promise.all(
            messages.map((message) => enrichMessage(instance, message, groupCache, avatarCache))
        );

        res.json({
            instanceId: instance.id,
            originTag: `${instance.id}:${instance.phoneNumber}`,
            conversationId: query.conversationId || null,
            count: data.length,
            data,
        });
    })
);

module.exports = router;
