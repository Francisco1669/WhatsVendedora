const axios = require("axios");
const env = require("../config/env");

function normalizeBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
}

function buildBaseUrls(url) {
    const primary = normalizeBaseUrl(url);
    if (!primary) {
        return [];
    }

    const urls = [primary];

    if (/^http:\/\/localhost(?::|\/|$)/i.test(primary)) {
        urls.push(primary.replace(/^http:\/\/localhost/i, "http://127.0.0.1"));
    }

    return [...new Set(urls)];
}

class EvolutionClient {
    constructor() {
        this.baseUrls = buildBaseUrls(env.EVOLUTION_API_URL);
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

    createHttpClient(baseURL) {
        return axios.create({
            baseURL,
            timeout: 15000,
            headers: {
                apikey: env.EVOLUTION_API_KEY,
                "Content-Type": "application/json",
            },
        });
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

        for (const baseURL of this.baseUrls) {
            const http = this.createHttpClient(baseURL);

            for (const request of requests) {
                try {
                    const response = await http.request(request);
                    return response.data;
                } catch (error) {
                    const status = error.response?.status;
                    failures.push({
                        baseURL,
                        request: `${(request.method || "GET").toUpperCase()} ${request.url}`,
                        status: status || "network",
                        message: error.response?.data?.message || error.message,
                    });

                    if (status && status >= 400 && status < 500 && status !== 404 && status !== 405) {
                        throw EvolutionClient.normalizeError(error);
                    }
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
        const webhookConfig = {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
        };

        const payloads = [
            webhookConfig,
            {
                webhook: {
                    ...webhookConfig,
                    headers: {
                        "x-webhook-token": webhookToken,
                    },
                },
            },
        ];

        return this.runFallbackRequests(
            payloads.flatMap((payload) => [
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
            ]),
            "configureWebhook"
        );
    }

    async provisionInstance({ instanceName, webhookUrl, webhookToken }) {
        const safeInstance = encodeURIComponent(instanceName);
        const createPayload = {
            instanceName,
            token: webhookToken,
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
            webhook: webhookUrl
                ? {
                    enabled: true,
                    url: webhookUrl,
                    webhookByEvents: false,
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

        return {
            createResult,
            webhookResult: null,
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
