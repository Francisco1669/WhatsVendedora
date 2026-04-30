const rateLimit = require("express-rate-limit");
const env = require("../config/env");

const loginLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
    limit: env.RATE_LIMIT_LOGIN_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Muitas tentativas de login. Tente novamente em alguns minutos.",
    },
});

const webhookLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WEBHOOK_WINDOW_MS,
    limit: env.RATE_LIMIT_WEBHOOK_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Limite de webhooks atingido temporariamente.",
    },
});

module.exports = {
    loginLimiter,
    webhookLimiter,
};
