require("dotenv").config();

const resolvedEvolutionApiKey =
    process.env.EVOAPICLOUD_API_KEY || process.env.EVOLUTION_API_KEY || "";
const resolvedEvolutionWebhookSecret =
    process.env.EVOAPICLOUD_GLOBAL_WEBHOOK_SECRET ||
    process.env.EVOLUTION_GLOBAL_WEBHOOK_SECRET ||
    resolvedEvolutionApiKey;

function parseNumber(value, fallbackValue) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
}

module.exports = {
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: parseNumber(process.env.PORT, 3333),
    EVOLUTION_API_URL: process.env.EVOAPICLOUD_API_URL || process.env.EVOLUTION_API_URL || "",
    EVOLUTION_API_KEY: resolvedEvolutionApiKey,
    EVOLUTION_GLOBAL_WEBHOOK_SECRET: resolvedEvolutionWebhookSecret,
    EVOLUTION_MANAGER_URL:
        process.env.EVOAPICLOUD_MANAGER_URL || process.env.EVOLUTION_MANAGER_URL || "",
    PUBLIC_WEBHOOK_BASE_URL: process.env.PUBLIC_WEBHOOK_BASE_URL || "",
    POSTGRES_DATABASE_URL:
        process.env.POSTGRES_DATABASE_URL ||
        process.env.DATABASE_URL ||
        "postgresql://evolution:evolution@127.0.0.1:5432/evolution",
    POSTGRES_SCHEMA: process.env.POSTGRES_SCHEMA || "whatsvendedora",
    POSTGRES_POOL_MAX: parseNumber(process.env.POSTGRES_POOL_MAX, 10),
    WEBHOOK_QUEUE_REDIS_URL:
        process.env.WEBHOOK_QUEUE_REDIS_URL ||
        process.env.REDIS_URL ||
        "redis://127.0.0.1:6379/7",
    WEBHOOK_QUEUE_NAME: process.env.WEBHOOK_QUEUE_NAME || "whatsvendedora-webhooks",
    WEBHOOK_QUEUE_CONCURRENCY: parseNumber(process.env.WEBHOOK_QUEUE_CONCURRENCY, 5),
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET || "",
    AUTH_JWT_EXPIRES_IN: process.env.AUTH_JWT_EXPIRES_IN || "12h",
    AUTH_DEFAULT_TENANT_SLUG: process.env.AUTH_DEFAULT_TENANT_SLUG || "tenant_default",
    AUTH_BCRYPT_ROUNDS: parseNumber(process.env.AUTH_BCRYPT_ROUNDS, 10),
    MULTI_TENANT_ENFORCED:
        String(process.env.MULTI_TENANT_ENFORCED || "false").toLowerCase() === "true",
    CORS_ALLOWED_ORIGINS: (process.env.CORS_ALLOWED_ORIGINS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    RATE_LIMIT_LOGIN_WINDOW_MS: parseNumber(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 15 * 60 * 1000),
    RATE_LIMIT_LOGIN_MAX: parseNumber(process.env.RATE_LIMIT_LOGIN_MAX, 10),
    RATE_LIMIT_WEBHOOK_WINDOW_MS: parseNumber(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS, 60 * 1000),
    RATE_LIMIT_WEBHOOK_MAX: parseNumber(process.env.RATE_LIMIT_WEBHOOK_MAX, 300),
    MESSAGE_RETENTION_DAYS: parseNumber(process.env.MESSAGE_RETENTION_DAYS, 15),
    ENABLE_RETENTION_JOB: String(process.env.ENABLE_RETENTION_JOB || "true").toLowerCase() === "true",
    OWNER_BOOTSTRAP_NAME: process.env.OWNER_BOOTSTRAP_NAME || "Dona",
    OWNER_BOOTSTRAP_EMAIL: process.env.OWNER_BOOTSTRAP_EMAIL || "",
    OWNER_BOOTSTRAP_PASSWORD: process.env.OWNER_BOOTSTRAP_PASSWORD || "",
    DEFAULT_PAGE_SIZE: parseNumber(process.env.DEFAULT_PAGE_SIZE, 50),
    MAX_PAGE_SIZE: parseNumber(process.env.MAX_PAGE_SIZE, 200),
    S3_ENDPOINT: process.env.S3_ENDPOINT || "",
    S3_REGION: process.env.S3_REGION || "auto",
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || "",
    S3_SECRET_KEY: process.env.S3_SECRET_KEY || "",
    S3_BUCKET: process.env.S3_BUCKET || "",
    S3_PUBLIC_URL_PREFIX: process.env.S3_PUBLIC_URL_PREFIX || "",
};
