const { randomBytes } = require("crypto");
const express = require("express");
const env = require("../config/env");
const {
    upsertInstance,
    listInstances,
    getInstanceById,
    getInstanceByEvolutionInstance,
    listInboundMessages,
    listInstanceConversations,
    saveInboundMessage,
    saveOutboundMessage,
    deleteInstancePermanently,
    recordAdminAudit,
} = require("../db/database");
const evolutionClient = require("../services/evolution-client");
const { normalizeInboundPayload } = require("../services/origin-resolver");
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
    const nonQrStates = new Set(["close", "connecting", "open", "connected", "disconnected"]);

    if (!qrData) {
        return false;
    }

    if (typeof qrData === "string") {
        const value = qrData.trim();
        if (!value) {
            return false;
        }

        return !nonQrStates.has(value.toLowerCase());
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

    return candidates.some((value) => {
        if (typeof value !== "string") {
            return false;
        }

        const normalized = value.trim().toLowerCase();
        return normalized.length > 0 && !nonQrStates.has(normalized);
    });
}

function buildIdSuffix() {
    return randomBytes(3).toString("hex");
}

async function allocateAvailableInstanceId(requestedId) {
    const normalizedBase = String(requestedId || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32);
    const base = normalizedBase || "seller";

    const exactMatch = await getInstanceById(base);
    if (!exactMatch) {
        return base;
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
        const candidate = `${base}_${buildIdSuffix()}`.slice(0, 40);
        const exists = await getInstanceById(candidate);
        if (!exists) {
            return candidate;
        }
    }

    throw new Error("Nao foi possivel gerar um identificador unico para a instancia.");
}

function classifyProvisionWarning(error) {
    const details = Array.isArray(error?.details) ? error.details : [];
    const has404 = details.some((item) => Number(item?.status) === 404);
    const hasNetwork = details.some((item) => String(item?.status) === "network");

    if (hasNetwork) {
        return "provision_evolution_unreachable";
    }

    if (has404) {
        return "provision_endpoint_unavailable";
    }

    return "provision_failed";
}

function hasQrCountZero(qrData) {
    if (!qrData || typeof qrData !== "object") {
        return false;
    }

    return Number(qrData?.count) === 0;
}

function hasConnectEndpointTimeout(connectError) {
    const details = Array.isArray(connectError?.details) ? connectError.details : [];
    return details.some((item) => {
        const request = String(item?.request || "").toUpperCase();
        const message = String(item?.message || "").toLowerCase();
        return request.includes("GET /INSTANCE/CONNECT/") && message.includes("timeout");
    });
}

function extractQrPayloadFromAny(rawPayload) {
    if (!rawPayload) {
        return null;
    }

    if (hasUsefulQrData(rawPayload)) {
        return rawPayload;
    }

    const candidates = [
        rawPayload?.qrcode,
        rawPayload?.qrCode,
        rawPayload?.qr,
        rawPayload?.base64,
        rawPayload?.code,
        rawPayload?.pairingCode,
        rawPayload?.data?.qrcode,
        rawPayload?.data?.qrCode,
        rawPayload?.data?.qr,
        rawPayload?.data?.base64,
        rawPayload?.data?.code,
        rawPayload?.data?.pairingCode,
    ];

    return candidates.find((item) => hasUsefulQrData(item)) || null;
}

function classifyPendingReason({
    evolutionReachable,
    qrData,
    connectError,
    connectionState,
    snapshot,
}) {
    if (hasUsefulQrData(qrData)) {
        return null;
    }

    if (!evolutionReachable) {
        return "evolution_unreachable";
    }

    if (hasConnectEndpointTimeout(connectError)) {
        return "qr_endpoint_timeout";
    }

    if (hasQrCountZero(qrData)) {
        return "qr_count_zero";
    }

    const details = Array.isArray(connectError?.details) ? connectError.details : [];
    if (details.some((item) => Number(item?.status) === 404)) {
        return "endpoint_404";
    }

    const state =
        String(
            connectionState?.instance?.state ||
                connectionState?.state ||
                snapshot?.instance?.status ||
                snapshot?.instance?.state ||
                snapshot?.status ||
                snapshot?.state ||
                ""
        )
            .trim()
            .toLowerCase() || null;

    if (state === "connecting") {
        return "connecting_no_qr";
    }

    return "qr_not_available";
}

function buildPendingWarning(reason) {
    if (reason === "evolution_unreachable") {
        return "Evolution indisponivel no momento. Aguarde alguns segundos e tente novamente.";
    }

    if (reason === "connecting_no_qr") {
        return "Instancia em connecting, mas sem QR ainda. Tente novamente em alguns segundos.";
    }

    if (reason === "qr_endpoint_timeout") {
        return "A Evolution esta conectando, mas o endpoint de QR estourou timeout.";
    }

    if (reason === "qr_count_zero") {
        return "A Evolution respondeu count=0 para o QR. Isso indica sessao travada ou QR ainda nao gerado.";
    }

    if (reason === "endpoint_404") {
        return "Evolution respondeu sem endpoint de QR compativel para este fluxo.";
    }

    return "QR ainda nao disponivel na Evolution. Tente novamente em alguns segundos.";
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDateTimeFromEvolution(record) {
    if (record?.messageTimestamp) {
        return new Date(Number(record.messageTimestamp) * 1000).toISOString();
    }

    return new Date().toISOString();
}

function wrapEvolutionHistoryMessage(instance, record) {
    return {
        event: "messages.history",
        instance: instance.evolutionInstance,
        data: record,
        date_time: toIsoDateTimeFromEvolution(record),
        sender: record?.key?.remoteJid || null,
    };
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
        const parsedPayload = instancePayloadSchema.parse(req.body || {});
        const allocatedId = await allocateAvailableInstanceId(parsedPayload.id);
        const payload = {
            ...parsedPayload,
            id: allocatedId,
        };

        const existingByEvolutionInstance = await getInstanceByEvolutionInstance(
            payload.evolutionInstance
        );
        if (existingByEvolutionInstance) {
            res.status(409).json({
                error: `Ja existe uma instancia com evolutionInstance '${payload.evolutionInstance}'.`,
                code: "evolution_instance_conflict",
            });
            return;
        }

        const webhookToken = payload.webhookToken || randomBytes(24).toString("hex");

        const saved = await upsertInstance({
            ...payload,
            webhookToken,
        });

        const shouldProvision = req.query.provision !== "false";
        const webhookUrl = `${buildWebhookBaseUrl(req)}/webhooks/evolution/${saved.id}`;

        let integration = {
            provisioned: false,
            webhookUrl,
            warnings: [],
            warningCodes: [],
        };

        if (shouldProvision) {
            try {
                const provisionResult = await evolutionClient.provisionInstance({
                    instanceName: saved.evolutionInstance,
                    webhookUrl,
                    webhookToken,
                });
                integration.provisioned = true;
                if (Array.isArray(provisionResult?.warnings)) {
                    for (const warning of provisionResult.warnings) {
                        const code = warning?.code || "provision_warning";
                        integration.warningCodes.push(code);
                        integration.warnings.push({
                            code,
                            message: warning?.message || "Aviso de provisionamento.",
                        });
                    }
                }
            } catch (error) {
                const code = classifyProvisionWarning(error);
                integration.warningCodes.push(code);
                integration.warnings.push({
                    code,
                    message: error.message,
                });
            }
        }

        await recordAdminAudit({
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
        const existing = await getInstanceById(req.params.instanceId);
        if (!existing) {
            res.status(404).json({ error: "Instancia nao encontrada." });
            return;
        }

        const payload = instanceUpdatePayloadSchema.parse(req.body || {});

        const saved = await upsertInstance({
            id: existing.id,
            label: payload.label ?? existing.label,
            phoneNumber: payload.phoneNumber ?? existing.phoneNumber,
            evolutionInstance: payload.evolutionInstance ?? existing.evolutionInstance,
            webhookToken: payload.webhookToken ?? existing.webhookToken,
            active: payload.active ?? Boolean(existing.active),
            status: payload.status ?? existing.status,
        });

        await recordAdminAudit({
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
        const existing = await getInstanceById(req.params.instanceId);
        if (!existing) {
            res.status(404).json({ error: "Instancia nao encontrada." });
            return;
        }

        const deleted = await deleteInstancePermanently(existing.id);

        await recordAdminAudit({
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
        const existing = await getInstanceById(req.params.instanceId);
        if (!existing) {
            res.status(404).json({ error: "Instancia nao encontrada." });
            return;
        }

        const saved = await upsertInstance({
            id: existing.id,
            label: existing.label,
            phoneNumber: existing.phoneNumber,
            evolutionInstance: existing.evolutionInstance,
            webhookToken: existing.webhookToken,
            active: false,
            status: "inactive",
        });

        await recordAdminAudit({
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
        const instances = (await listInstances()).map((item) => sanitizeInstance(item));

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
        const instance = await getInstanceById(req.params.instanceId);
        if (!instance || !instance.active) {
            res.status(404).json({ error: "Instancia nao encontrada ou inativa." });
            return;
        }

        let qrData = null;
        let connectError = null;
        let connectionState = null;
        let snapshot = null;
        let evolutionReachable = true;

        const persistedQr = extractQrPayloadFromAny(instance.lastQrPayload);
        if (hasUsefulQrData(persistedQr)) {
            qrData = persistedQr;
        }

        try {
            await evolutionClient.ping(2500);
        } catch (error) {
            evolutionReachable = false;
            connectError = connectError || error;
        }

        if (!evolutionReachable && !hasUsefulQrData(qrData)) {
            const pendingConnectionReason = classifyPendingReason({
                evolutionReachable,
                qrData,
                connectError,
                connectionState,
                snapshot,
            });

            res.json({
                data: {
                    instanceId: instance.id,
                    originTag: `${instance.id}:${instance.phoneNumber}`,
                    qrData: null,
                    pendingConnection: true,
                    pendingConnectionReason,
                    warning: buildPendingWarning(pendingConnectionReason),
                    connectErrorDetails: connectError?.details || null,
                    connectionState: null,
                    diagnostics: {
                        snapshotState: null,
                        evolutionReachable: false,
                        endpointSummary: Array.isArray(connectError?.details)
                            ? connectError.details.map((entry) => ({
                                  request: entry.request || null,
                                  status: entry.status || null,
                              }))
                            : null,
                    },
                },
            });
            return;
        }

        if (evolutionReachable) {
            try {
                const freshQrData = await evolutionClient.requestConnectionQr(instance.evolutionInstance);
                if (hasUsefulQrData(freshQrData)) {
                    qrData = freshQrData;
                }
            } catch (error) {
                connectError = error;
            }
        }

        if (!hasUsefulQrData(qrData) && evolutionReachable) {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                await wait(1200);

                try {
                    const polledQrData = await Promise.race([
                        evolutionClient.requestConnectionQr(instance.evolutionInstance),
                        wait(3500).then(() => null),
                    ]);
                    if (hasUsefulQrData(polledQrData)) {
                        qrData = polledQrData;
                        break;
                    }
                } catch (error) {
                    req.log?.warn?.(
                        { err: error, evolutionInstance: instance.evolutionInstance, attempt: attempt + 1 },
                        "Falha ao consultar QR em polling"
                    );
                }

                const refreshedInstance = await getInstanceById(instance.id);
                const refreshedQr = extractQrPayloadFromAny(refreshedInstance?.lastQrPayload);
                if (hasUsefulQrData(refreshedQr)) {
                    qrData = refreshedQr;
                    break;
                }
            }
        }

        if (!hasUsefulQrData(qrData) && evolutionClient.isConfigured() && evolutionReachable) {
            try {
                snapshot = await evolutionClient.fetchInstanceSnapshot(instance.evolutionInstance);
                if (snapshot) {
                    qrData =
                        snapshot?.instance?.qrcode ||
                        snapshot?.qrcode ||
                        snapshot?.instance?.qrCode ||
                        snapshot?.qrCode ||
                        snapshot?.instance?.code ||
                        snapshot?.code ||
                        qrData;
                } else if (connectError?.status === 404) {
                    const webhookUrl = `${buildWebhookBaseUrl(req)}/webhooks/evolution/${instance.id}`;
                    await evolutionClient.provisionInstance({
                        instanceName: instance.evolutionInstance,
                        webhookUrl,
                        webhookToken: instance.webhookToken,
                    });
                    qrData = await evolutionClient.requestConnectionQr(instance.evolutionInstance);
                }
            } catch (error) {
                req.log?.warn?.(
                    { err: error, evolutionInstance: instance.evolutionInstance },
                    "Falha ao consultar fetchInstances para QR fallback"
                );
            }
        }

        if (evolutionClient.isConfigured() && evolutionReachable) {
            try {
                connectionState = await evolutionClient.fetchConnectionState(instance.evolutionInstance);
            } catch (error) {
                connectionState = {
                    error: "Nao foi possivel consultar estado de conexao na Evolution.",
                    detail: error.message,
                };
            }
        }

        const pendingConnection = !hasUsefulQrData(qrData);
        const connectErrorDetails = connectError?.details || null;
        const pendingConnectionReason = classifyPendingReason({
            evolutionReachable,
            qrData,
            connectError,
            connectionState,
            snapshot,
        });

        res.json({
            data: {
                instanceId: instance.id,
                originTag: `${instance.id}:${instance.phoneNumber}`,
                qrData,
                pendingConnection,
                pendingConnectionReason: pendingConnection ? pendingConnectionReason : null,
                warning: pendingConnection ? buildPendingWarning(pendingConnectionReason) : undefined,
                connectErrorDetails,
                connectionState,
                diagnostics: {
                    snapshotState:
                        snapshot?.instance?.status ||
                        snapshot?.instance?.state ||
                        snapshot?.status ||
                        snapshot?.state ||
                        null,
                    evolutionReachable,
                    endpointSummary: Array.isArray(connectErrorDetails)
                        ? connectErrorDetails.map((entry) => ({
                              request: entry.request || null,
                              status: entry.status || null,
                          }))
                        : null,
                },
            },
        });
    })
);

router.post(
    "/instances/:instanceId/send",
    asyncHandler(async (req, res) => {
        const parsedBody = sendMessageSchema.parse(req.body || {});
        const instance = await getInstanceById(req.params.instanceId);

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

        await saveOutboundMessage({
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

        await recordAdminAudit({
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
        const instance = await getInstanceById(req.params.instanceId);
        if (!instance) {
            res.status(404).json({ error: "Instancia nao encontrada." });
            return;
        }

        const query = instanceMessagesQuerySchema.parse(req.query || {});
        const conversations = await listInstanceConversations({
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

router.post(
    "/instances/:instanceId/sync",
    asyncHandler(async (req, res) => {
        const instance = await getInstanceById(req.params.instanceId);
        if (!instance || !instance.active) {
            res.status(404).json({ error: "Instancia nao encontrada ou inativa." });
            return;
        }

        const maxPages = Math.min(Math.max(Number(req.query.maxPages || 5), 1), 50);
        const conversationId = req.query.conversationId ? String(req.query.conversationId) : null;
        const where = conversationId
            ? {
                  key: {
                      remoteJid: conversationId,
                  },
              }
            : {};

        let imported = 0;
        let deduplicated = 0;
        let scanned = 0;
        let totalRemote = 0;
        let pages = 0;

        for (let page = 1; page <= maxPages; page += 1) {
            const result = await evolutionClient.fetchMessages({
                instanceName: instance.evolutionInstance,
                where,
                page,
            });
            const payload = result?.messages || result;
            const records = payload?.records || [];
            totalRemote = Number(payload?.total || totalRemote || records.length);
            pages = Number(payload?.pages || pages || 1);

            if (!records.length) {
                break;
            }

            for (const record of records) {
                scanned += 1;
                const normalized = normalizeInboundPayload({
                    payload: wrapEvolutionHistoryMessage(instance, record),
                    instanceRecord: instance,
                    routeInstanceId: instance.id,
                    headerInstanceName: instance.evolutionInstance,
                });
                const resultSave = await saveInboundMessage(normalized);
                if (resultSave.inserted) {
                    imported += 1;
                } else {
                    deduplicated += 1;
                }
            }

            if (page >= pages) {
                break;
            }
        }

        await recordAdminAudit({
            adminUserId: req.auth?.user?.id || null,
            action: "INSTANCE_HISTORY_SYNC",
            instanceId: instance.id,
            metadata: {
                conversationId,
                maxPages,
                pages,
                totalRemote,
                scanned,
                imported,
                deduplicated,
            },
        });

        res.json({
            instanceId: instance.id,
            conversationId,
            maxPages,
            pages,
            totalRemote,
            scanned,
            imported,
            deduplicated,
        });
    })
);

router.get(
    "/instances/:instanceId/messages",
    asyncHandler(async (req, res) => {
        const instance = await getInstanceById(req.params.instanceId);
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

        const messages = await listInboundMessages({
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
