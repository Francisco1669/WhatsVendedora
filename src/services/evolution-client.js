const axios = require("axios");
const env = require("../config/env");

class EvolutionClient {
    constructor() {
        this.http = axios.create({
            baseURL: env.EVOLUTION_API_URL,
            timeout: 15000,
            headers: {
                apikey: env.EVOLUTION_API_KEY,
                "Content-Type": "application/json",
            },
        });
    }

    isConfigured() {
        return Boolean(env.EVOLUTION_API_URL && env.EVOLUTION_API_KEY);
    }

    ensureConfigured() {
        if (!this.isConfigured()) {
            const error = new Error("Evolution API nao configurada. Ajuste EVOLUTION_API_URL e EVOLUTION_API_KEY.");
            error.status = 503;
            throw error;
        }
    }

    static normalizeError(error) {
        const normalized = new Error(
            error.response?.data?.message || error.response?.data?.error || error.message
        );
        normalized.status = error.response?.status || 502;
        normalized.details = error.response?.data || null;
        return normalized;
    }

    async runFallbackRequests(requests, actionName) {
        this.ensureConfigured();
        const failures = [];

        for (const request of requests) {
            try {
                const response = await this.http.request(request);
                return response.data;
            } catch (error) {
                const status = error.response?.status;
                failures.push({
                    request: `${(request.method || "GET").toUpperCase()} ${request.url}`,
                    status: status || "network",
                    message: error.response?.data?.message || error.message,
                });

                if (status && status >= 400 && status < 500 && status !== 404 && status !== 405) {
                    throw EvolutionClient.normalizeError(error);
                }
            }
        }

        const fallbackError = new Error(
            `Nao foi possivel executar '${actionName}' com os endpoints conhecidos da Evolution API.`
        );
        fallbackError.status = 502;
        fallbackError.details = failures;
        throw fallbackError;
    }

    async configureWebhook(instanceName, webhookUrl, webhookToken) {
        const safeInstance = encodeURIComponent(instanceName);
        const payload = {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: true,
            webhookBase64: false,
            events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
            headers: {
                "x-webhook-token": webhookToken,
            },
        };

        return this.runFallbackRequests(
            [
                {
                    method: "post",
                    url: `/webhook/set/${safeInstance}`,
                    data: payload,
                },
                {
                    method: "post",
                    url: `/instance/webhook/${safeInstance}`,
                    data: payload,
                },
                {
                    method: "put",
                    url: `/instances/${safeInstance}/webhook`,
                    data: payload,
                },
            ],
            "configureWebhook"
        );
    }

    async provisionInstance({ instanceName, webhookUrl, webhookToken }) {
        const safeInstance = encodeURIComponent(instanceName);
        const createPayload = {
            instanceName,
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
            webhook: webhookUrl
                ? {
                    enabled: true,
                    url: webhookUrl,
                    webhookByEvents: true,
                    webhookBase64: false,
                    events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
                    headers: {
                        "x-webhook-token": webhookToken,
                    },
                }
                : undefined,
        };

        const createResult = await this.runFallbackRequests(
            [
                {
                    method: "post",
                    url: "/instance/create",
                    data: createPayload,
                },
                {
                    method: "post",
                    url: `/instance/create/${safeInstance}`,
                    data: createPayload,
                },
                {
                    method: "post",
                    url: "/instances",
                    data: {
                        name: instanceName,
                        qrcode: true,
                    },
                },
            ],
            "provisionInstance"
        );

        let webhookResult = null;
        if (webhookUrl) {
            webhookResult = await this.configureWebhook(instanceName, webhookUrl, webhookToken);
        }

        return {
            createResult,
            webhookResult,
        };
    }

    async fetchConnectionState(instanceName) {
        const safeInstance = encodeURIComponent(instanceName);
        return this.runFallbackRequests(
            [
                {
                    method: "get",
                    url: `/instance/connectionState/${safeInstance}`,
                },
                {
                    method: "get",
                    url: "/instance/connectionState",
                    params: { instanceName },
                },
                {
                    method: "get",
                    url: `/instances/${safeInstance}`,
                },
            ],
            "fetchConnectionState"
        );
    }

    async requestConnectionQr(instanceName) {
        const safeInstance = encodeURIComponent(instanceName);
        return this.runFallbackRequests(
            [
                {
                    method: "get",
                    url: `/instance/connect/${safeInstance}`,
                },
                {
                    method: "post",
                    url: `/instance/connect/${safeInstance}`,
                    data: {},
                },
                {
                    method: "get",
                    url: `/instance/qrcode/${safeInstance}`,
                },
            ],
            "requestConnectionQr"
        );
    }

    async sendTextMessage({ instanceName, to, text }) {
        const safeInstance = encodeURIComponent(instanceName);
        return this.runFallbackRequests(
            [
                {
                    method: "post",
                    url: `/message/sendText/${safeInstance}`,
                    data: {
                        number: to,
                        text,
                    },
                },
                {
                    method: "post",
                    url: "/message/sendText",
                    data: {
                        instance: instanceName,
                        number: to,
                        text,
                    },
                },
                {
                    method: "post",
                    url: "/messages/send",
                    data: {
                        instanceName,
                        to,
                        text,
                    },
                },
            ],
            "sendTextMessage"
        );
    }
}

module.exports = new EvolutionClient();
