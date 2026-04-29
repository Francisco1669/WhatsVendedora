const { Queue, Worker } = require("bullmq");
const env = require("../config/env");
const logger = require("../lib/logger");

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
    if (webhookWorker) {
        return webhookWorker;
    }

    webhookWorker = new Worker(
        getQueueName(),
        async (job) => processor(job.data, job),
        {
            connection: buildRedisConnectionOptions(env.WEBHOOK_QUEUE_REDIS_URL),
            concurrency: env.WEBHOOK_QUEUE_CONCURRENCY,
        }
    );

    webhookWorker.on("completed", (job, result) => {
        logger.info(
            {
                jobId: job.id,
                eventName: result?.eventName,
                instanceId: result?.instanceId,
                stored: result?.stored,
            },
            "Webhook job completed"
        );
    });

    webhookWorker.on("failed", (job, error) => {
        logger.error(
            {
                jobId: job?.id,
                attemptsMade: job?.attemptsMade,
                err: error,
            },
            "Webhook job failed"
        );
    });

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
