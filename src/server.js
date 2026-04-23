const env = require("./config/env");
const app = require("./app");
const logger = require("./lib/logger");
const {
    initializeDatabase,
    closeDatabase,
    bootstrapOwnerUser,
} = require("./db/database");
const { hashPassword } = require("./services/password-service");

initializeDatabase();

function bootstrapOwnerFromEnv() {
    if (!env.OWNER_BOOTSTRAP_EMAIL || !env.OWNER_BOOTSTRAP_PASSWORD) {
        logger.warn(
            "Conta inicial da dona nao criada: configure OWNER_BOOTSTRAP_EMAIL e OWNER_BOOTSTRAP_PASSWORD."
        );
        return;
    }

    const result = bootstrapOwnerUser({
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

bootstrapOwnerFromEnv();

const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Multi-instance WhatsApp manager running");
});

function shutdown(signal) {
    logger.info({ signal }, "Shutting down application");

    server.close(() => {
        closeDatabase();
        process.exit(0);
    });

    setTimeout(() => {
        process.exit(1);
    }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
