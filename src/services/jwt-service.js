const jwt = require("jsonwebtoken");
const env = require("../config/env");

const ISSUER = "testezap";

function isJwtConfigured() {
    return Boolean(env.AUTH_JWT_SECRET);
}

function assertJwtConfigured() {
    if (!isJwtConfigured()) {
        const error = new Error("JWT nao configurado. Defina AUTH_JWT_SECRET.");
        error.status = 503;
        throw error;
    }
}

function signAccessToken(adminUser) {
    assertJwtConfigured();

    return jwt.sign(
        {
            sub: String(adminUser.id),
            role: adminUser.role,
            name: adminUser.name,
            email: adminUser.email,
        },
        env.AUTH_JWT_SECRET,
        {
            expiresIn: env.AUTH_JWT_EXPIRES_IN,
            issuer: ISSUER,
        }
    );
}

function verifyAccessToken(token) {
    assertJwtConfigured();

    try {
        return jwt.verify(token, env.AUTH_JWT_SECRET, {
            issuer: ISSUER,
        });
    } catch (error) {
        const normalized = new Error("Token JWT invalido ou expirado.");
        normalized.status = 401;
        throw normalized;
    }
}

module.exports = {
    isJwtConfigured,
    signAccessToken,
    verifyAccessToken,
};
