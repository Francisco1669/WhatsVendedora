const express = require("express");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const cors = require("cors");
const pinoHttp = require("pino-http");
const logger = require("./lib/logger");
const env = require("./config/env");
const authRouter = require("./routes/auth");
const instancesRouter = require("./routes/instances");
const messagesRouter = require("./routes/messages");
const webhooksRouter = require("./routes/webhooks");
const { requireAuth } = require("./middleware/require-auth");

const app = express();
const panelStaticPath = path.join(__dirname, "public");

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
    helmet({
        contentSecurityPolicy: false,
    })
);
app.use(
    cors({
        origin(origin, callback) {
            if (!origin) {
                callback(null, true);
                return;
            }

            if (env.CORS_ALLOWED_ORIGINS.length === 0 || env.CORS_ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
                return;
            }

            const error = new Error("Origem nao permitida por CORS.");
            error.status = 403;
            callback(error);
        },
        credentials: true,
    })
);
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
    const incoming = req.get("x-request-id");
    const requestId = incoming && String(incoming).trim() ? incoming.trim() : crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
});
app.use(
    pinoHttp({
        logger,
        genReqId: (req) => req.requestId,
    })
);
app.use("/panel", express.static(panelStaticPath, { index: "index.html" }));

app.get("/", (req, res) => {
    res.redirect("/panel");
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "multi-instance-whatsapp-manager",
        timestamp: new Date().toISOString(),
    });
});

app.use("/", webhooksRouter);
app.use("/auth", authRouter);
app.use("/api", requireAuth, instancesRouter);
app.use("/api", requireAuth, messagesRouter);

app.use((error, req, res, next) => {
    if (req.log && typeof req.log.error === "function") {
        req.log.error({ err: error }, "Request failed");
    } else {
        logger.error({ err: error }, "Request failed before request logger initialization");
    }

    const status = error.status || 500;
    const responsePayload = {
        error: error.message || "Erro interno.",
    };

    if (error.details) {
        responsePayload.details = error.details;
    }

    if (error.issues) {
        responsePayload.validation = error.issues;
    }

    res.status(status).json(responsePayload);
});

module.exports = app;
