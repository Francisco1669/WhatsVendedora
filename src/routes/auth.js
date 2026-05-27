const express = require("express");
const env = require("../config/env");
const asyncHandler = require("../utils/async-handler");
const {
    getAdminUserByEmail,
    getTenantBySlug,
    recordAdminAudit,
} = require("../db/database");
const { comparePassword } = require("../services/password-service");
const { signAccessToken, isJwtConfigured } = require("../services/jwt-service");
const { loginSchema } = require("../validation/schemas");
const { requireAuth } = require("../middleware/require-auth");
const { loginLimiter } = require("../middleware/rate-limiters");

const router = express.Router();

router.use(loginLimiter);

router.post(
    "/login",
    asyncHandler(async (req, res) => {
        const payload = loginSchema.parse(req.body || {});

        if (!isJwtConfigured()) {
            res.status(503).json({
                error: "Autenticacao JWT nao configurada no servidor.",
            });
            return;
        }

        const tenant = await getTenantBySlug(payload.tenantSlug);
        if (!tenant || !tenant.active) {
            res.status(401).json({
                error: "Tenant invalido ou inativo.",
            });
            return;
        }

        const tenantId = tenant.id;
        const adminUser = await getAdminUserByEmail(payload.email, tenantId);
        const isValidPassword =
            adminUser && adminUser.active
                ? comparePassword(payload.password, adminUser.passwordHash)
                : false;

        if (!isValidPassword) {
            await recordAdminAudit({
                adminUserId: adminUser?.id || null,
                tenantId,
                action: "AUTH_LOGIN_FAILED",
                metadata: {
                    email: payload.email.toLowerCase(),
                    tenantSlug: payload.tenantSlug,
                    ip: req.ip,
                    userAgent: req.get("user-agent") || null,
                },
            });

            res.status(401).json({
                error: "Credenciais invalidas.",
            });
            return;
        }

        const accessToken = signAccessToken(adminUser);

        await recordAdminAudit({
            adminUserId: adminUser.id,
            tenantId,
            action: "AUTH_LOGIN_SUCCESS",
            metadata: {
                ip: req.ip,
                userAgent: req.get("user-agent") || null,
            },
        });

        res.json({
            tokenType: "Bearer",
            accessToken,
            expiresIn: env.AUTH_JWT_EXPIRES_IN,
            user: {
                id: adminUser.id,
                name: adminUser.name,
                email: adminUser.email,
                role: adminUser.role,
                tenantId: adminUser.tenantId || tenantId,
                tenantSlug: adminUser.tenantSlug || tenant.slug,
            },
        });
    })
);

router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
        res.json({
            user: req.auth.user,
        });
    })
);

module.exports = router;
