const pino = require("pino");
const env = require("../config/env");

module.exports = pino({
    level: process.env.LOG_LEVEL || (env.NODE_ENV === "development" ? "debug" : "info"),
});
