const env = require("./config/env");
const app = require("./app");
const logger = require("./lib/logger");
const { createHash } = require("crypto");
const {
    initializeDatabase,
    closeDatabase,
    bootstrapOwnerUser,
} = require("./db/database");
const { hashPassword } = require("./services/password-service");
const { startWebhookWorker, closeWebhookQueue } = require("./services/queue");
const { processEvolutionWebhookJob } = require("./services/webhook-processor");

async function bootstrapOwnerFromEnv() {
    if (!env.OWNER_BOOTSTRAP_EMAIL || !env.OWNER_BOOTSTRAP_PASSWORD) {
        logger.warn(
            "Conta inicial da dona nao criada: configure OWNER_BOOTSTRAP_EMAIL e OWNER_BOOTSTRAP_PASSWORD."
        );
        return;
    }

    const result = await bootstrapOwnerUser({
        name: env.OWNER_BOOTSTRAP_NAME,
        email: env.OWNER_BOOTSTRAP_EMAIL,
        passwordHash: hashPassword(env.OWNER_BOOTSTRAP_PASSWORD),
    });

    if (result.created) {
        logger.info(
            { email: env.OWNER_BOOTSTRAP_EMAIL.toLowerCase() },
            "Conta inicial da dona criada com sucesso"
        );
        return;
    }

    logger.info(
        {
            email: env.OWNER_BOOTSTRAP_EMAIL.toLowerCase(),
            reason: result.reason,
        },
        "Bootstrap da conta da dona ignorado"
    );
}

let server;

async function start() {
    await initializeDatabase();
    await bootstrapOwnerFromEnv();
    startWebhookWorker(processEvolutionWebhookJob);

    const evolutionKeyFingerprint = env.EVOLUTION_API_KEY
        ? createHash("sha256").update(env.EVOLUTION_API_KEY).digest("hex").slice(0, 12)
        : null;

    logger.info(
        {
            evolutionApiUrl: env.EVOLUTION_API_URL || null,
            evolutionKeyFingerprint,
            webhookBaseUrl: env.PUBLIC_WEBHOOK_BASE_URL || null,
            corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
        },
        "Runtime integration snapshot"
    );

    server = app.listen(env.PORT, "0.0.0.0", () => {
        logger.info({ port: env.PORT, host: "0.0.0.0" }, "Multi-instance WhatsApp manager running");
    });
}

function shutdown(signal) {
    logger.info({ signal }, "Shutting down application");

    if (!server) {
        Promise.all([closeWebhookQueue(), closeDatabase()]).finally(() => process.exit(0));
        return;
    }

    server.close(() => {
        Promise.all([closeWebhookQueue(), closeDatabase()]).finally(() => process.exit(0));
    });

    setTimeout(() => {
        process.exit(1);
    }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((error) => {
    logger.error({ err: error }, "Failed to start application");
    Promise.all([closeWebhookQueue(), closeDatabase()]).finally(() => process.exit(1));
});
