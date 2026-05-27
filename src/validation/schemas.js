const { z } = require("zod");

const isoDateString = z.string().trim().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "Data deve estar em formato de data valido."
);

const instancePayloadSchema = z.object({
    id: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/),
    label: z.string().trim().min(2).max(80),
    phoneNumber: z.string().trim().min(8).max(20).regex(/^[0-9+]+$/),
    evolutionInstance: z.string().trim().min(2).max(80),
    webhookToken: z.string().trim().min(8).max(120).optional(),
    active: z.boolean().optional().default(true),
});

const instanceUpdatePayloadSchema = z
    .object({
        label: z.string().trim().min(2).max(80).optional(),
        phoneNumber: z.string().trim().min(8).max(20).regex(/^[0-9+]+$/).optional(),
        evolutionInstance: z.string().trim().min(2).max(80).optional(),
        webhookToken: z.string().trim().min(8).max(120).optional(),
        active: z.boolean().optional(),
        status: z.string().trim().min(2).max(40).optional(),
    })
    .refine((payload) => Object.keys(payload).length > 0, {
        message: "Informe ao menos um campo para atualizar.",
    });

const sendMessageSchema = z.object({
    to: z.string().trim().min(8).max(25).regex(/^[0-9+]+$/),
    text: z.string().trim().min(1).max(4096),
});

const messageQuerySchema = z.object({
    instanceId: z.string().trim().min(1).optional(),
    originTag: z.string().trim().min(1).optional(),
    receivedAfter: isoDateString.optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

const instanceMessagesQuerySchema = z.object({
    conversationId: z.string().trim().min(1).optional(),
    receivedAfter: isoDateString.optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

const auditQuerySchema = z.object({
    adminUserId: z.coerce.number().int().positive().optional(),
    instanceId: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

const loginSchema = z.object({
    tenantSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
    email: z.string().trim().email(),
    password: z.string().min(6).max(120),
});

module.exports = {
    instancePayloadSchema,
    instanceUpdatePayloadSchema,
    sendMessageSchema,
    messageQuerySchema,
    instanceMessagesQuerySchema,
    auditQuerySchema,
    loginSchema,
};
