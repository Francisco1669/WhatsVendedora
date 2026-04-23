const express = require("express");
const env = require("../config/env");
const {
    listInboundMessages,
    listOrigins,
    listSellerSummaries,
    listAdminAudits,
} = require("../db/database");
const asyncHandler = require("../utils/async-handler");
const { messageQuerySchema, auditQuerySchema } = require("../validation/schemas");

const router = express.Router();

router.get(
    "/messages",
    asyncHandler(async (req, res) => {
        const parsedQuery = messageQuerySchema.parse(req.query || {});
        const limit = Math.min(parsedQuery.limit || env.DEFAULT_PAGE_SIZE, env.MAX_PAGE_SIZE);
        const offset = parsedQuery.offset || 0;

        const data = listInboundMessages({
            instanceId: parsedQuery.instanceId,
            originTag: parsedQuery.originTag,
            receivedAfter: parsedQuery.receivedAfter,
            limit,
            offset,
        });

        res.json({
            filters: {
                instanceId: parsedQuery.instanceId || null,
                originTag: parsedQuery.originTag || null,
                receivedAfter: parsedQuery.receivedAfter || null,
                limit,
                offset,
            },
            count: data.length,
            data,
        });
    })
);

router.get(
    "/seller-summary",
    asyncHandler(async (req, res) => {
        const data = listSellerSummaries();
        res.json({
            totalSellers: data.length,
            data,
        });
    })
);

router.get(
    "/messages/origins",
    asyncHandler(async (req, res) => {
        const data = listOrigins();
        res.json({
            totalOrigins: data.length,
            data,
        });
    })
);

router.get(
    "/audit",
    asyncHandler(async (req, res) => {
        const parsedQuery = auditQuerySchema.parse(req.query || {});
        const limit = Math.min(parsedQuery.limit || env.DEFAULT_PAGE_SIZE, env.MAX_PAGE_SIZE);
        const offset = parsedQuery.offset || 0;

        const data = listAdminAudits({
            adminUserId: parsedQuery.adminUserId,
            instanceId: parsedQuery.instanceId,
            limit,
            offset,
        });

        res.json({
            filters: {
                adminUserId: parsedQuery.adminUserId || null,
                instanceId: parsedQuery.instanceId || null,
                limit,
                offset,
            },
            count: data.length,
            data,
        });
    })
);

module.exports = router;
