const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { normalizeTenantId } = require("./tenant-scope");

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
    const tenantId = normalizeTenantId(adminUser.tenantId);
    if (env.MULTI_TENANT_ENFORCED && !tenantId) {
        const error = new Error("Nao foi possivel emitir JWT sem tenantId.");
        error.status = 401;
        throw error;
    }

    return jwt.sign(
        {
            sub: String(adminUser.id),
            role: adminUser.role,
            name: adminUser.name,
            email: adminUser.email,
            tenantId: tenantId || undefined,
            tenantSlug: adminUser.tenantSlug || undefined,
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
