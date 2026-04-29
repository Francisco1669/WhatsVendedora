const { getAdminUserById } = require("../db/database");
const { verifyAccessToken } = require("../services/jwt-service");

function extractBearerToken(req) {
    const authHeader = req.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
        return null;
    }

    return authHeader.slice(7).trim();
}

async function requireAuth(req, res, next) {
    try {
        const token = extractBearerToken(req);

        if (!token) {
            const error = new Error("Token JWT ausente. Use Authorization: Bearer <token>.");
            error.status = 401;
            next(error);
            return;
        }

        const payload = verifyAccessToken(token);
        const userId = Number(payload.sub || 0);
        const adminUser = await getAdminUserById(userId);

        if (!adminUser || !adminUser.active) {
            const error = new Error("Usuario administrativo nao encontrado ou inativo.");
            error.status = 401;
            next(error);
            return;
        }

        req.auth = {
            tokenPayload: payload,
            user: {
                id: adminUser.id,
                name: adminUser.name,
                email: adminUser.email,
                role: adminUser.role,
            },
        };

        next();
    } catch (error) {
        next(error);
    }
}

module.exports = {
    requireAuth,
};
