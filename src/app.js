const express = require("express");
const path = require("path");
const pinoHttp = require("pino-http");
const logger = require("./lib/logger");
const authRouter = require("./routes/auth");
const instancesRouter = require("./routes/instances");
const messagesRouter = require("./routes/messages");
const webhooksRouter = require("./routes/webhooks");
const { requireAuth } = require("./middleware/require-auth");

const app = express();
const panelStaticPath = path.join(__dirname, "public");

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(pinoHttp({ logger }));
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
    req.log.error({ err: error }, "Request failed");

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
