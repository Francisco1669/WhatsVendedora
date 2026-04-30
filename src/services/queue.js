const { Queue, Worker } = require("bullmq");
const env = require("../config/env");
const logger = require("../lib/logger");
const db = require("../db/database");

let webhookQueue;
let webhookWorker;

function getQueueName() {
    return String(env.WEBHOOK_QUEUE_NAME || "whatsvendedora-webhooks").replace(/:/g, "-");
}

function buildRedisConnectionOptions(redisUrl) {
    const url = new URL(redisUrl);

    return {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
        db: url.pathname ? Number(url.pathname.replace("/", "") || 0) : 0,
        maxRetriesPerRequest: null,
    };
}

function getWebhookQueue() {
    if (!webhookQueue) {
        webhookQueue = new Queue(getQueueName(), {
            connection: buildRedisConnectionOptions(env.WEBHOOK_QUEUE_REDIS_URL),
            defaultJobOptions: {
                attempts: 5,
                backoff: {
                    type: "exponential",
                    delay: 2000,
                },
                removeOnComplete: 1000,
                removeOnFail: 5000,
            },
        });
    }

    return webhookQueue;
}

async function enqueueEvolutionWebhook(payload) {
    const queue = getWebhookQueue();
    const eventName = payload?.body?.event || payload?.body?.type || "unknown";
    return queue.add("evolution-webhook", payload, {
        jobId: payload.requestId || undefined,
        priority: eventName.toLowerCase().includes("message") ? 1 : 2,
    });
}

function startWebhookWorker(processor) {
    if (!webhookWorker) {
        webhookWorker = new Worker(
            getQueueName(),
            async (job) => {
                if (job.name === "prune-database") {
                    try {
                        const deleted = await db.pruneOldMessages(env.MESSAGE_RETENTION_DAYS);
                        logger.info({ deleted, days: env.MESSAGE_RETENTION_DAYS }, "Scheduled pruning of old messages completed.");
                        return { ok: true, deleted, eventName: "prune" };
                    } catch (err) {
                        logger.error({ err }, "Scheduled pruning failed.");
                        throw err;
                    }
                }
                
                return processor(job.data, job);
            },
            {
                connection: buildRedisConnectionOptions(env.WEBHOOK_QUEUE_REDIS_URL),
                concurrency: env.WEBHOOK_QUEUE_CONCURRENCY,
            }
        );

        webhookWorker.on("completed", (job, result) => {
            logger.info(
                {
                    jobId: job.id,
                    jobName: job.name,
                    eventName: result?.eventName,
                    instanceId: result?.instanceId,
                    stored: result?.stored,
                },
                "Job completed successfully"
            );
        });

        webhookWorker.on("failed", (job, error) => {
            logger.error(
                {
                    jobId: job?.id,
                    jobName: job?.name,
                    attemptsMade: job?.attemptsMade,
                    err: error,
                },
                "Job failed"
            );
        });
        
        if (env.ENABLE_RETENTION_JOB) {
            // Schedule repeatable pruning job at 3:00 AM daily if worker is starting
            const queue = getWebhookQueue();
            queue.add("prune-database", {}, { repeat: { pattern: "0 3 * * *" } }).catch((err) => {
                logger.error({ err }, "Failed to schedule prune-database repeatable job");
            });
        }
    }

    return webhookWorker;
}

async function closeWebhookQueue() {
    if (webhookWorker) {
        await webhookWorker.close();
        webhookWorker = null;
    }

    if (webhookQueue) {
        await webhookQueue.close();
        webhookQueue = null;
    }
}

module.exports = {
    enqueueEvolutionWebhook,
    startWebhookWorker,
    closeWebhookQueue,
};
