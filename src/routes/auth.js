const express = require("express");
const env = require("../config/env");
const asyncHandler = require("../utils/async-handler");
const {
    getAdminUserByEmail,
    recordAdminAudit,
} = require("../db/database");
const { comparePassword } = require("../services/password-service");
const { signAccessToken, isJwtConfigured } = require("../services/jwt-service");
const { loginSchema } = require("../validation/schemas");
const { requireAuth } = require("../middleware/require-auth");

const router = express.Router();

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

        const adminUser = await getAdminUserByEmail(payload.email);
        const isValidPassword =
            adminUser && adminUser.active
                ? comparePassword(payload.password, adminUser.passwordHash)
                : false;

        if (!isValidPassword) {
            await recordAdminAudit({
                adminUserId: adminUser?.id || null,
                action: "AUTH_LOGIN_FAILED",
                metadata: {
                    email: payload.email.toLowerCase(),
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
