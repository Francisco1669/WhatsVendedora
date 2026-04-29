const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const env = require("../config/env");
const log = require("../lib/logger");

const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

function generateUniqueFilename(mimeType, extensionHint) {
  const hash = crypto.randomBytes(16).toString("hex");
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  
  let ext = extensionHint;
  if (!ext) {
    if (mimeType?.includes("jpeg") || mimeType?.includes("jpg")) ext = "jpg";
    else if (mimeType?.includes("png")) ext = "png";
    else if (mimeType?.includes("webp")) ext = "webp";
    else if (mimeType?.includes("mp4")) ext = "mp4";
    else if (mimeType?.includes("mp3")) ext = "mp3";
    else if (mimeType?.includes("ogg") || mimeType?.includes("oga")) ext = "ogg";
    else if (mimeType?.includes("pdf")) ext = "pdf";
    else ext = "bin";
  } else {
      ext = ext.replace(/^\./, "");
  }

  return `${dateStr}-${hash}.${ext}`;
}

async function uploadBase64Media(base64Data, mimeType, extensionHint = null) {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY) {
    log.warn("S3 is not fully configured, ignoring media upload");
    return null;
  }

  try {
    const buffer = Buffer.from(base64Data, "base64");
    const fileName = generateUniqueFilename(mimeType, extensionHint);
    const key = `media/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType || "application/octet-stream",
    });

    await s3Client.send(command);

    if (env.S3_PUBLIC_URL_PREFIX) {
        const prefix = env.S3_PUBLIC_URL_PREFIX.replace(/\/$/, "");
        return `${prefix}/${key}`;
    }

    // Default to a path/bucket URL format if no custom public URL
    return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;
  } catch (error) {
    log.error({ err: error }, "Failed to upload media to S3");
    return null;
  }
}

module.exports = {
  uploadBase64Media,
};