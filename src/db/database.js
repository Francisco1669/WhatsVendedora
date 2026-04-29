const { Pool } = require("pg");
const env = require("../config/env");

const state = {
  pool: null,
  initialized: false,
  initPromise: null,
};

function quoteIdentifier(value) {
  return String(value || "public").replace(/"/g, '""');
}

function tableName(table) {
  return `"${quoteIdentifier(env.POSTGRES_SCHEMA)}"."${quoteIdentifier(table)}"`;
}

function createPool() {
  if (state.pool) {
    return state.pool;
  }

  state.pool = new Pool({
    connectionString: env.POSTGRES_DATABASE_URL,
    max: env.POSTGRES_POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  return state.pool;
}

function parseJsonSafe(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return {
      raw: value,
      parseError: true,
    };
  }
}

function normalizeJidValue(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePhoneValue(value) {
  const jid = normalizeJidValue(value);
  if (!jid) {
    return null;
  }

  if (jid.includes("@g.us")) {
    return null;
  }

  const phone = jid.replace(/@.*/, "").replace(/[^0-9+]/g, "");
  return phone || null;
}

function jidLooksInternal(value) {
  const jid = normalizeJidValue(value);
  return !jid || jid.includes("@lid") || jid.includes("@g.us");
}

function pickExternalJid(...values) {
  for (const value of values) {
    const jid = normalizeJidValue(value);
    if (jid && !jidLooksInternal(jid)) {
      return jid;
    }
  }

  return null;
}

function pickAnyJid(...values) {
  for (const value of values) {
    const jid = normalizeJidValue(value);
    if (jid) {
      return jid;
    }
  }

  return null;
}

function pickMessageEnvelope(rawPayload) {
  const payload = parseJsonSafe(rawPayload) || {};
  const data = payload.data;

  if (Array.isArray(data)) {
    return data[0] || {};
  }

  if (data && typeof data === "object") {
    if (Array.isArray(data.messages)) {
      return data.messages[0] || {};
    }

    return data;
  }

  return payload;
}

function isUsefulPushName(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();
  if (!trimmed || lowered === "voce" || lowered === "você" || lowered === "vocÃª") {
    return false;
  }

  return !/^\d{8,}$/.test(trimmed);
}

function getMessageContactDetails(row) {
  const envelope = pickMessageEnvelope(row.rawPayload);
  const key = envelope?.key || {};
  const fromMe = Boolean(row.fromMe);
  const conversationId =
    normalizeJidValue(row.chatJid) ||
    normalizeJidValue(key.remoteJid) ||
    normalizeJidValue(envelope?.remoteJid) ||
    normalizeJidValue(row.fromJid) ||
    normalizeJidValue(row.toJid) ||
    "unknown";

  const preferredJid = fromMe
    ? pickExternalJid(row.toJid, key.remoteJid, envelope?.remoteJid, key.remoteJidAlt, envelope?.remoteJidAlt) ||
      pickAnyJid(row.toJid, key.remoteJidAlt, key.remoteJid)
    : pickExternalJid(
        key.participantAlt,
        envelope?.participantAlt,
        row.fromJid,
        key.remoteJid,
        envelope?.remoteJid,
        key.remoteJidAlt,
        envelope?.remoteJidAlt
      ) ||
      pickAnyJid(key.participantAlt, envelope?.participantAlt, row.fromJid, key.remoteJidAlt, key.remoteJid);

  const contactPhone = normalizePhoneValue(preferredJid);
  const contactName = !fromMe && isUsefulPushName(envelope?.pushName) ? envelope.pushName.trim() : null;
  const isGroup = conversationId.includes("@g.us");
  const contactDisplay = contactName
    ? contactPhone
      ? `${contactName} (${contactPhone})`
      : contactName
    : contactPhone || (isGroup ? "Grupo" : "Contato sem numero");

  return {
    conversationId,
    isGroup,
    conversationType: isGroup ? "group" : "individual",
    contactJid: preferredJid,
    contactPhone,
    contactName,
    contactDisplay,
  };
}

function getCanonicalConversationId(message) {
  if (message.isGroup) {
    return message.conversationId;
  }

  if (message.contactPhone && !String(message.contactPhone).includes("@lid")) {
    return `${message.contactPhone.replace(/^\+/, "")}@s.whatsapp.net`;
  }

  return message.conversationId || message.contactJid || "unknown";
}

function collectMessageJidAliases(row) {
  const envelope = pickMessageEnvelope(row.rawPayload);
  const key = envelope?.key || {};
  const ownPhone = normalizePhoneValue(row.originPhone);
  const normalizedOwnPhone = ownPhone ? ownPhone.replace(/^\+/, "") : null;
  const aliases = [
    row.chatJid,
    row.fromJid,
    row.toJid,
    key.remoteJid,
    key.remoteJidAlt,
    key.participant,
    key.participantAlt,
    envelope?.remoteJid,
    envelope?.remoteJidAlt,
    envelope?.participant,
    envelope?.participantAlt,
  ];

  return Array.from(
    new Set(
      aliases
        .map(normalizeJidValue)
        .filter(Boolean)
        .filter((alias) => {
          const aliasPhone = normalizePhoneValue(alias);
          return !normalizedOwnPhone || !aliasPhone || aliasPhone.replace(/^\+/, "") !== normalizedOwnPhone;
        })
    )
  );
}

function mergeConversationAliases(existing, row, conversationId) {
  const aliases = new Set(existing.conversationAliases || []);
  for (const alias of [conversationId, row.conversationId, row.contactJid, ...collectMessageJidAliases(row)]) {
    if (alias) {
      aliases.add(alias);
    }
  }

  existing.conversationAliases = Array.from(aliases);
}

function objectBytesToBase64(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.every((key) => /^\d+$/.test(key))) {
    return null;
  }

  const bytes = keys
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => Number(value[key]));

  return Buffer.from(bytes).toString("base64");
}

function getMessageMediaDetails(rawPayload) {
  const envelope = pickMessageEnvelope(rawPayload);
  const message = envelope?.message || {};
  const image = message.imageMessage;

  if (!image) {
    return {
      mediaType: null,
      mediaUrl: null,
      mediaThumbnail: null,
      mediaMimeType: null,
    };
  }

  const thumbnail = objectBytesToBase64(image.jpegThumbnail);
  return {
    mediaType: "image",
    mediaUrl: image.url || null,
    mediaThumbnail: thumbnail ? `data:image/jpeg;base64,${thumbnail}` : null,
    mediaMimeType: image.mimetype || "image/jpeg",
  };
}

function hasRenderableContent(message) {
  return Boolean(
    (message.textBody && String(message.textBody).trim()) ||
      message.mediaThumbnail ||
      message.mediaUrl
  );
}

function getMentionLabel(message) {
  if (message.contactName) {
    return message.contactName;
  }

  if (message.contactPhone) {
    return message.contactPhone;
  }

  return null;
}

function isBetterConversationIdentity(existing, row) {
  if (row.isGroup) {
    return false;
  }

  if (!existing.contactPhone && row.contactPhone) {
    return true;
  }

  if (!existing.contactName && row.contactName) {
    return true;
  }

  if (existing.contactName && !row.contactName) {
    return false;
  }

  if (existing.contactDisplay === "Contato sem numero" && row.contactDisplay !== "Contato sem numero") {
    return true;
  }

  return !row.fromMe && Boolean(row.contactName || row.contactPhone);
}

function applyMentionLabels(messages) {
  const mentionLabels = new Map();

  for (const message of messages) {
    for (const jid of [message.fromJid, message.contactJid]) {
      const normalized = normalizeJidValue(jid);
      const label = getMentionLabel(message);
      if (normalized?.includes("@lid") && label) {
        mentionLabels.set(normalized.replace(/@.*/, ""), label);
      }
    }
  }

  if (mentionLabels.size === 0) {
    return messages;
  }

  return messages.map((message) => {
    if (!message.textBody) {
      return message;
    }

    const textBody = String(message.textBody).replace(/@(\d{8,})/g, (match, id) => {
      const label = mentionLabels.get(id);
      return label ? `@${label}` : "@contato sem numero";
    });

    return {
      ...message,
      textBody,
    };
  });
}

function decorateInboundMessage(row) {
  const { rawPayload, ...message } = row;
  const envelope = pickMessageEnvelope(rawPayload);
  const messageType =
    ["messageContextInfo", "senderKeyDistributionMessage", "unknown"].includes(message.messageType) &&
    envelope?.messageType
      ? envelope.messageType
      : message.messageType;
  const decorated = {
    ...message,
    fromMe: Boolean(message.fromMe),
    messageType,
    rawPayload,
    ...getMessageContactDetails(row),
    ...getMessageMediaDetails(rawPayload),
  };

  return {
    ...decorated,
    displayable: hasRenderableContent(decorated),
  };
}

function mapInstanceRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    active: Boolean(row.active),
    lastQrPayload: parseJsonSafe(row.lastQrPayload),
  };
}

async function initializeDatabase() {
  if (state.initialized) {
    return state.pool;
  }

  if (state.initPromise) {
    return state.initPromise;
  }

  state.initPromise = (async () => {
    const pool = createPool();
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${quoteIdentifier(env.POSTGRES_SCHEMA)}"`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName("instances")} (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        evolution_instance TEXT NOT NULL UNIQUE,
        webhook_token TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_qr_payload JSONB,
        last_qr_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ${tableName("inbound_messages")} (
        id BIGSERIAL PRIMARY KEY,
        evolution_message_id TEXT NOT NULL,
        instance_id TEXT NOT NULL REFERENCES ${tableName("instances")}(id) ON DELETE CASCADE,
        origin_tag TEXT NOT NULL,
        origin_phone TEXT NOT NULL,
        event_name TEXT NOT NULL,
        chat_jid TEXT,
        from_jid TEXT,
        to_jid TEXT,
        from_me BOOLEAN NOT NULL DEFAULT FALSE,
        message_type TEXT NOT NULL DEFAULT 'unknown',
        text_body TEXT,
        raw_payload JSONB NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(evolution_message_id, instance_id)
      );

      CREATE TABLE IF NOT EXISTS ${tableName("outbound_messages")} (
        id BIGSERIAL PRIMARY KEY,
        instance_id TEXT NOT NULL REFERENCES ${tableName("instances")}(id) ON DELETE CASCADE,
        origin_tag TEXT NOT NULL,
        to_jid TEXT NOT NULL,
        text_body TEXT NOT NULL,
        response_payload JSONB,
        sent_by_user_id BIGINT,
        sent_by_user_name TEXT,
        sent_by_user_role TEXT,
        request_id TEXT,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ${tableName("admin_users")} (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ${tableName("admin_audit_logs")} (
        id BIGSERIAL PRIMARY KEY,
        admin_user_id BIGINT REFERENCES ${tableName("admin_users")}(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        instance_id TEXT REFERENCES ${tableName("instances")}(id) ON DELETE SET NULL,
        target_jid TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_wv_instances_phone ON ${tableName("instances")}(phone_number);
      CREATE INDEX IF NOT EXISTS idx_wv_messages_instance ON ${tableName("inbound_messages")}(instance_id, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wv_messages_origin ON ${tableName("inbound_messages")}(origin_tag, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wv_admin_users_email ON ${tableName("admin_users")}(email);
      CREATE INDEX IF NOT EXISTS idx_wv_admin_audit_logs_user ON ${tableName("admin_audit_logs")}(admin_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wv_admin_audit_logs_instance ON ${tableName("admin_audit_logs")}(instance_id, created_at DESC);
    `);

    state.initialized = true;
    return pool;
  })();

  return state.initPromise;
}

async function query(text, values = []) {
  await initializeDatabase();
  return state.pool.query(text, values);
}

async function upsertInstance(instanceData) {
  const result = await query(
    `
      INSERT INTO ${tableName("instances")} (
        id,
        label,
        phone_number,
        evolution_instance,
        webhook_token,
        active,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'unknown'))
      ON CONFLICT(id) DO UPDATE SET
        label = EXCLUDED.label,
        phone_number = EXCLUDED.phone_number,
        evolution_instance = EXCLUDED.evolution_instance,
        webhook_token = EXCLUDED.webhook_token,
        active = EXCLUDED.active,
        status = COALESCE(EXCLUDED.status, ${tableName("instances")}.status),
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        id,
        label,
        phone_number AS "phoneNumber",
        evolution_instance AS "evolutionInstance",
        webhook_token AS "webhookToken",
        active,
        status,
        last_qr_payload AS "lastQrPayload",
        last_qr_at AS "lastQrAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      instanceData.id,
      instanceData.label,
      instanceData.phoneNumber,
      instanceData.evolutionInstance,
      instanceData.webhookToken,
      Boolean(instanceData.active),
      instanceData.status || null,
    ]
  );

  return mapInstanceRow(result.rows[0]);
}

async function getInstanceById(instanceId) {
  const result = await query(
    `
      SELECT
        id,
        label,
        phone_number AS "phoneNumber",
        evolution_instance AS "evolutionInstance",
        webhook_token AS "webhookToken",
        active,
        status,
        last_qr_payload AS "lastQrPayload",
        last_qr_at AS "lastQrAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ${tableName("instances")}
      WHERE id = $1
    `,
    [instanceId]
  );

  return mapInstanceRow(result.rows[0]);
}

async function getInstanceByEvolutionInstance(evolutionInstance) {
  const result = await query(
    `
      SELECT
        id,
        label,
        phone_number AS "phoneNumber",
        evolution_instance AS "evolutionInstance",
        webhook_token AS "webhookToken",
        active,
        status,
        last_qr_payload AS "lastQrPayload",
        last_qr_at AS "lastQrAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ${tableName("instances")}
      WHERE evolution_instance = $1
    `,
    [evolutionInstance]
  );

  return mapInstanceRow(result.rows[0]);
}

async function listInstances() {
  const result = await query(
    `
      SELECT
        id,
        label,
        phone_number AS "phoneNumber",
        evolution_instance AS "evolutionInstance",
        webhook_token AS "webhookToken",
        active,
        status,
        last_qr_payload AS "lastQrPayload",
        last_qr_at AS "lastQrAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ${tableName("instances")}
      ORDER BY created_at ASC
    `
  );

  return result.rows.map(mapInstanceRow);
}

async function setInstanceStatus(instanceId, status) {
  await query(
    `
      UPDATE ${tableName("instances")}
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
    [status, instanceId]
  );
}

async function setInstanceLatestQr(instanceId, qrPayload) {
  await query(
    `
      UPDATE ${tableName("instances")}
      SET last_qr_payload = $1::jsonb, last_qr_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
    [JSON.stringify(qrPayload || {}), instanceId]
  );
}

async function saveInboundMessage(messageData) {
  const result = await query(
    `
      INSERT INTO ${tableName("inbound_messages")} (
        evolution_message_id,
        instance_id,
        origin_tag,
        origin_phone,
        event_name,
        chat_jid,
        from_jid,
        to_jid,
        from_me,
        message_type,
        text_body,
        raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      ON CONFLICT(evolution_message_id, instance_id) DO NOTHING
      RETURNING id
    `,
    [
      messageData.evolutionMessageId,
      messageData.instanceId,
      messageData.originTag,
      messageData.originPhone,
      messageData.eventName,
      messageData.chatJid || null,
      messageData.fromJid || null,
      messageData.toJid || null,
      Boolean(messageData.fromMe),
      messageData.messageType || "unknown",
      messageData.textBody || "",
      messageData.rawPayload,
    ]
  );

  return {
    inserted: result.rowCount > 0,
    rowId: Number(result.rows[0]?.id || 0),
  };
}

async function saveOutboundMessage(outboundData) {
  const result = await query(
    `
      INSERT INTO ${tableName("outbound_messages")} (
        instance_id,
        origin_tag,
        to_jid,
        text_body,
        response_payload,
        sent_by_user_id,
        sent_by_user_name,
        sent_by_user_role,
        request_id
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
      RETURNING id
    `,
    [
      outboundData.instanceId,
      outboundData.originTag,
      outboundData.toJid,
      outboundData.textBody,
      outboundData.responsePayload || null,
      outboundData.sentByUserId || null,
      outboundData.sentByUserName || null,
      outboundData.sentByUserRole || null,
      outboundData.requestId || null,
    ]
  );

  return Number(result.rows[0]?.id || 0);
}

function selectInboundColumns() {
  return `
    id,
    evolution_message_id AS "evolutionMessageId",
    instance_id AS "instanceId",
    origin_tag AS "originTag",
    origin_phone AS "originPhone",
    event_name AS "eventName",
    chat_jid AS "chatJid",
    from_jid AS "fromJid",
    to_jid AS "toJid",
    from_me AS "fromMe",
    message_type AS "messageType",
    text_body AS "textBody",
    raw_payload AS "rawPayload",
    received_at AS "receivedAt"
  `;
}

async function listInboundMessages(filters) {
  const clauses = [];
  const values = [];

  if (filters.instanceId) {
    values.push(filters.instanceId);
    clauses.push(`instance_id = $${values.length}`);
  }

  if (filters.conversationId) {
    const conversationAliases = await resolveConversationAliases(filters.instanceId, filters.conversationId);
    values.push(conversationAliases);
    clauses.push(`(
      chat_jid = ANY($${values.length}) OR
      from_jid = ANY($${values.length}) OR
      to_jid = ANY($${values.length}) OR
      raw_payload #>> '{data,key,remoteJid}' = ANY($${values.length}) OR
      raw_payload #>> '{data,key,remoteJidAlt}' = ANY($${values.length}) OR
      raw_payload #>> '{data,key,participant}' = ANY($${values.length}) OR
      raw_payload #>> '{data,key,participantAlt}' = ANY($${values.length})
    )`);
  }

  if (filters.originTag) {
    values.push(filters.originTag);
    clauses.push(`origin_tag = $${values.length}`);
  }

  if (filters.receivedAfter) {
    values.push(filters.receivedAfter);
    clauses.push(`received_at >= $${values.length}`);
  }

  values.push(Math.max(1, filters.limit || 50));
  const limitParam = `$${values.length}`;
  values.push(Math.max(0, filters.offset || 0));
  const offsetParam = `$${values.length}`;
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const result = await query(
    `
      SELECT ${selectInboundColumns()}
      FROM ${tableName("inbound_messages")}
      ${whereClause}
      ORDER BY received_at DESC, id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    values
  );

  return applyMentionLabels(
    result.rows.map(decorateInboundMessage).filter((row) => row.displayable)
  );
}

async function resolveConversationAliases(instanceId, conversationId) {
  const normalizedConversationId = normalizeJidValue(conversationId);
  if (!normalizedConversationId) {
    return ["unknown"];
  }

  const aliases = new Set([normalizedConversationId]);
  const targetPhone = normalizePhoneValue(normalizedConversationId);

  const clauses = [];
  const values = [];
  if (instanceId) {
    values.push(instanceId);
    clauses.push(`instance_id = $${values.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await query(
    `
      SELECT ${selectInboundColumns()}
      FROM ${tableName("inbound_messages")}
      ${whereClause}
      ORDER BY received_at DESC, id DESC
      LIMIT 5000
    `,
    values
  );

  for (const rawRow of result.rows) {
    const row = decorateInboundMessage(rawRow);
    const rowAliases = collectMessageJidAliases(row);
    const canonicalId = getCanonicalConversationId(row);
    const rowPhones = new Set(
      [row.contactPhone, ...rowAliases.map(normalizePhoneValue)]
        .map((value) => (value ? String(value).replace(/^\+/, "") : null))
        .filter(Boolean)
    );
    const normalizedTargetPhone = targetPhone ? String(targetPhone).replace(/^\+/, "") : null;
    const matchesConversation =
      row.conversationId === normalizedConversationId ||
      row.contactJid === normalizedConversationId ||
      canonicalId === normalizedConversationId ||
      rowAliases.includes(normalizedConversationId) ||
      (normalizedTargetPhone && rowPhones.has(normalizedTargetPhone));

    if (!matchesConversation) {
      continue;
    }

    for (const alias of [canonicalId, row.conversationId, row.contactJid, ...rowAliases]) {
      if (alias) {
        aliases.add(alias);
      }
    }
  }

  return Array.from(aliases);
}

async function listInstanceConversations(filters) {
  const clauses = ["instance_id = $1"];
  const values = [filters.instanceId];

  if (filters.receivedAfter) {
    values.push(filters.receivedAfter);
    clauses.push(`received_at >= $${values.length}`);
  }

  const result = await query(
    `
      SELECT ${selectInboundColumns()}
      FROM ${tableName("inbound_messages")}
      WHERE ${clauses.join(" AND ")}
      ORDER BY received_at DESC, id DESC
      LIMIT 1000
    `,
    values
  );

  const rows = applyMentionLabels(result.rows.map(decorateInboundMessage));
  const grouped = new Map();
  for (const row of rows.filter((item) => item.displayable)) {
    const conversationId = getCanonicalConversationId(row);
    const existing = grouped.get(conversationId);

    if (!existing) {
      const conversation = {
        conversationId,
        conversationAliases: [],
        isGroup: Boolean(row.isGroup),
        conversationType: row.conversationType,
        contactJid: row.contactJid,
        contactPhone: row.contactPhone,
        contactName: row.contactName,
        contactDisplay: row.contactDisplay,
        displayName: row.isGroup ? "Grupo" : row.contactDisplay,
        lastMessageAt: row.receivedAt,
        lastTextBody: row.textBody,
        lastMessageType: row.messageType,
        totalMessages: 1,
      };
      mergeConversationAliases(conversation, row, conversationId);
      grouped.set(conversationId, conversation);
      continue;
    }

    mergeConversationAliases(existing, row, conversationId);
    existing.totalMessages += 1;
    if (!existing.contactPhone && row.contactPhone) {
      existing.contactPhone = row.contactPhone;
    }
    if (!existing.contactName && row.contactName) {
      existing.contactName = row.contactName;
    }
    if (isBetterConversationIdentity(existing, row)) {
      existing.contactJid = row.contactJid;
      existing.contactPhone = row.contactPhone;
      existing.contactName = row.contactName;
      existing.contactDisplay = row.contactDisplay;
      existing.displayName = row.contactDisplay;
    }
    if (
      existing.contactDisplay === existing.conversationId.replace(/@.*/, "") &&
      row.contactDisplay
    ) {
      existing.contactDisplay = row.contactDisplay;
    }
    if (existing.displayName === "Grupo" && row.isGroup) {
      existing.displayName = "Grupo";
    }
  }

  return Array.from(grouped.values());
}

async function listOrigins() {
  const result = await query(
    `
      SELECT
        m.origin_tag AS "originTag",
        m.instance_id AS "instanceId",
        i.label AS "instanceLabel",
        m.origin_phone AS "originPhone",
        COUNT(*)::int AS "totalMessages",
        MAX(m.received_at) AS "lastMessageAt"
      FROM ${tableName("inbound_messages")} m
      LEFT JOIN ${tableName("instances")} i ON i.id = m.instance_id
      GROUP BY m.origin_tag, m.instance_id, i.label, m.origin_phone
      ORDER BY "lastMessageAt" DESC
    `
  );

  return result.rows;
}

async function getAdminUserByEmail(email) {
  const result = await query(
    `
      SELECT
        id,
        name,
        email,
        password_hash AS "passwordHash",
        role,
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ${tableName("admin_users")}
      WHERE email = $1
    `,
    [(email || "").toLowerCase()]
  );

  return result.rows[0] || null;
}

async function getAdminUserById(userId) {
  const result = await query(
    `
      SELECT
        id,
        name,
        email,
        role,
        active,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ${tableName("admin_users")}
      WHERE id = $1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function countAdminUsers() {
  const result = await query(`SELECT COUNT(*)::int AS total FROM ${tableName("admin_users")}`);
  return Number(result.rows[0]?.total || 0);
}

async function createAdminUser(userData) {
  const result = await query(
    `
      INSERT INTO ${tableName("admin_users")} (
        name,
        email,
        password_hash,
        role,
        active
      ) VALUES ($1, $2, $3, COALESCE($4, 'owner'), $5)
      RETURNING id
    `,
    [
      userData.name,
      userData.email.toLowerCase(),
      userData.passwordHash,
      userData.role || "owner",
      userData.active === false ? false : true,
    ]
  );

  return getAdminUserById(Number(result.rows[0]?.id || 0));
}

async function bootstrapOwnerUser(userData) {
  if (!userData.email || !userData.passwordHash) {
    return {
      created: false,
      reason: "missing_credentials",
      user: null,
    };
  }

  const existingByEmail = await getAdminUserByEmail(userData.email);
  if (existingByEmail) {
    return {
      created: false,
      reason: "already_exists",
      user: existingByEmail,
    };
  }

  if ((await countAdminUsers()) > 0) {
    return {
      created: false,
      reason: "owner_already_bootstrapped",
      user: null,
    };
  }

  const createdUser = await createAdminUser({
    name: userData.name,
    email: userData.email,
    passwordHash: userData.passwordHash,
    role: "owner",
    active: true,
  });

  return {
    created: true,
    reason: "created",
    user: createdUser,
  };
}

async function recordAdminAudit(auditData) {
  const result = await query(
    `
      INSERT INTO ${tableName("admin_audit_logs")} (
        admin_user_id,
        action,
        instance_id,
        target_jid,
        metadata
      ) VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING id
    `,
    [
      auditData.adminUserId || null,
      auditData.action,
      auditData.instanceId || null,
      auditData.targetJid || null,
      auditData.metadata ? JSON.stringify(auditData.metadata) : null,
    ]
  );

  return Number(result.rows[0]?.id || 0);
}

async function listAdminAudits(filters = {}) {
  const clauses = [];
  const values = [];

  if (filters.adminUserId) {
    values.push(filters.adminUserId);
    clauses.push(`a.admin_user_id = $${values.length}`);
  }

  if (filters.instanceId) {
    values.push(filters.instanceId);
    clauses.push(`a.instance_id = $${values.length}`);
  }

  values.push(Math.max(1, filters.limit || 50));
  const limitParam = `$${values.length}`;
  values.push(Math.max(0, filters.offset || 0));
  const offsetParam = `$${values.length}`;
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const result = await query(
    `
      SELECT
        a.id,
        a.admin_user_id AS "adminUserId",
        u.name AS "adminUserName",
        u.email AS "adminUserEmail",
        a.action,
        a.instance_id AS "instanceId",
        a.target_jid AS "targetJid",
        a.metadata,
        a.created_at AS "createdAt"
      FROM ${tableName("admin_audit_logs")} a
      LEFT JOIN ${tableName("admin_users")} u ON u.id = a.admin_user_id
      ${whereClause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    values
  );

  return result.rows.map((row) => ({
    ...row,
    metadata: parseJsonSafe(row.metadata),
  }));
}

async function listSellerSummaries() {
  const result = await query(
    `
      SELECT
        i.id AS "instanceId",
        i.label AS "sellerLabel",
        i.phone_number AS "phoneNumber",
        i.evolution_instance AS "evolutionInstance",
        i.status AS "connectionStatus",
        i.active,
        COALESCE(inbound."totalInbound", 0)::int AS "totalInbound",
        COALESCE(outbound."totalOutbound", 0)::int AS "totalOutbound",
        COALESCE(recent_inbound."totalInbound24h", 0)::int AS "inboundLast24h",
        inbound."lastInboundAt",
        outbound."lastOutboundAt"
      FROM ${tableName("instances")} i
      LEFT JOIN (
        SELECT
          instance_id,
          COUNT(*)::int AS "totalInbound",
          MAX(received_at) AS "lastInboundAt"
        FROM ${tableName("inbound_messages")}
        GROUP BY instance_id
      ) inbound ON inbound.instance_id = i.id
      LEFT JOIN (
        SELECT
          instance_id,
          COUNT(*)::int AS "totalOutbound",
          MAX(sent_at) AS "lastOutboundAt"
        FROM ${tableName("outbound_messages")}
        GROUP BY instance_id
      ) outbound ON outbound.instance_id = i.id
      LEFT JOIN (
        SELECT
          instance_id,
          COUNT(*)::int AS "totalInbound24h"
        FROM ${tableName("inbound_messages")}
        WHERE received_at >= NOW() - INTERVAL '1 day'
        GROUP BY instance_id
      ) recent_inbound ON recent_inbound.instance_id = i.id
      ORDER BY i.label ASC, i.id ASC
    `
  );

  return result.rows.map((row) => ({
    ...row,
    active: Boolean(row.active),
  }));
}

async function deleteInstancePermanently(instanceId) {
  await initializeDatabase();
  const client = await state.pool.connect();

  try {
    await client.query("BEGIN");
    const deletedAudits = await client.query(
      `DELETE FROM ${tableName("admin_audit_logs")} WHERE instance_id = $1`,
      [instanceId]
    );
    const deletedInbound = await client.query(
      `DELETE FROM ${tableName("inbound_messages")} WHERE instance_id = $1`,
      [instanceId]
    );
    const deletedOutbound = await client.query(
      `DELETE FROM ${tableName("outbound_messages")} WHERE instance_id = $1`,
      [instanceId]
    );
    const deletedInstances = await client.query(
      `DELETE FROM ${tableName("instances")} WHERE id = $1`,
      [instanceId]
    );
    await client.query("COMMIT");

    return {
      deletedAudits: deletedAudits.rowCount,
      deletedInbound: deletedInbound.rowCount,
      deletedOutbound: deletedOutbound.rowCount,
      deletedInstances: deletedInstances.rowCount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function pruneOldMessages(days = 15) {
  const query = `
    DELETE FROM ${tableName("messages")} 
    WHERE created_at < NOW() - INTERVAL '${Number(days)} days'
  `;
  const { rowCount } = await state.pool.query(query);
  return rowCount;
}

async function closeDatabase() {
  if (state.pool) {
    await state.pool.end();
    state.pool = null;
    state.initialized = false;
    state.initPromise = null;
  }
}

module.exports = {
  initializeDatabase,
  upsertInstance,
  getInstanceById,
  getInstanceByEvolutionInstance,
  listInstances,
  setInstanceStatus,
  setInstanceLatestQr,
  saveInboundMessage,
  saveOutboundMessage,
  listInboundMessages,
  listInstanceConversations,
  listOrigins,
  getAdminUserByEmail,
  getAdminUserById,
  createAdminUser,
  countAdminUsers,
  bootstrapOwnerUser,
  recordAdminAudit,
  listAdminAudits,
  listSellerSummaries,
  deleteInstancePermanently,
  pruneOldMessages,
  closeDatabase,
};
