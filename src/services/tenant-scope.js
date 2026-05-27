const env = require("../config/env");

function normalizeTenantId(value) {
    const normalized = String(value || "").trim();
    return normalized || null;
}

function assertTenantScope(tenantId) {
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (env.MULTI_TENANT_ENFORCED && !normalizedTenantId) {
        const error = new Error("Tenant ausente no contexto autenticado.");
        error.status = 401;
        throw error;
    }

    return normalizedTenantId;
}

function buildTenantLoggerContext(req, extra = {}) {
    return {
        requestId: req.requestId || req.get?.("x-request-id") || null,
        userId: req.auth?.user?.id || null,
        tenantId: req.auth?.user?.tenantId || null,
        ...extra,
    };
}

module.exports = {
    normalizeTenantId,
    assertTenantScope,
    buildTenantLoggerContext,
};
