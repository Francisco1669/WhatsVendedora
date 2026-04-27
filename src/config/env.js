const path = require("path");

require("dotenv").config();

function parseNumber(value, fallbackValue) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
}

module.exports = {
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: parseNumber(process.env.PORT, 3333),
    EVOLUTION_API_URL: process.env.EVOAPICLOUD_API_URL || process.env.EVOLUTION_API_URL || "",
    EVOLUTION_API_KEY: process.env.EVOAPICLOUD_API_KEY || process.env.EVOLUTION_API_KEY || "",
    EVOLUTION_GLOBAL_WEBHOOK_SECRET:
        process.env.EVOAPICLOUD_GLOBAL_WEBHOOK_SECRET ||
        process.env.EVOLUTION_GLOBAL_WEBHOOK_SECRET ||
        "",
    EVOLUTION_MANAGER_URL:
        process.env.EVOAPICLOUD_MANAGER_URL || process.env.EVOLUTION_MANAGER_URL || "",
    PUBLIC_WEBHOOK_BASE_URL: process.env.PUBLIC_WEBHOOK_BASE_URL || "",
    DB_PATH: process.env.DB_PATH || path.join(process.cwd(), "data", "multi-instance.db"),
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET || "",
    AUTH_JWT_EXPIRES_IN: process.env.AUTH_JWT_EXPIRES_IN || "12h",
    AUTH_BCRYPT_ROUNDS: parseNumber(process.env.AUTH_BCRYPT_ROUNDS, 10),
    OWNER_BOOTSTRAP_NAME: process.env.OWNER_BOOTSTRAP_NAME || "Dona",
    OWNER_BOOTSTRAP_EMAIL: process.env.OWNER_BOOTSTRAP_EMAIL || "",
    OWNER_BOOTSTRAP_PASSWORD: process.env.OWNER_BOOTSTRAP_PASSWORD || "",
    DEFAULT_PAGE_SIZE: parseNumber(process.env.DEFAULT_PAGE_SIZE, 50),
    MAX_PAGE_SIZE: parseNumber(process.env.MAX_PAGE_SIZE, 200),
};
