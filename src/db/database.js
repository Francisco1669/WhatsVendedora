const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const env = require("../config/env");

const state = {
  db: null,
  statements: null,
};

function ensureColumnExists(db, tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

function parseJsonSafe(value) {
  if (!value) {
    return null;
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

function initializeDatabase() {
  if (state.db) {
    return state.db;
  }

  fs.mkdirSync(path.dirname(env.DB_PATH), { recursive: true });

  const db = new Database(env.DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      evolution_instance TEXT NOT NULL UNIQUE,
      webhook_token TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inbound_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evolution_message_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      origin_tag TEXT NOT NULL,
      origin_phone TEXT NOT NULL,
      event_name TEXT NOT NULL,
      chat_jid TEXT,
      from_jid TEXT,
      to_jid TEXT,
      from_me INTEGER NOT NULL DEFAULT 0,
      message_type TEXT NOT NULL DEFAULT 'unknown',
      text_body TEXT,
      raw_payload TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(instance_id) REFERENCES instances(id),
      UNIQUE(evolution_message_id, instance_id)
    );

    CREATE TABLE IF NOT EXISTS outbound_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      origin_tag TEXT NOT NULL,
      to_jid TEXT NOT NULL,
      text_body TEXT NOT NULL,
      response_payload TEXT,
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(instance_id) REFERENCES instances(id)
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER,
      action TEXT NOT NULL,
      instance_id TEXT,
      target_jid TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(admin_user_id) REFERENCES admin_users(id),
      FOREIGN KEY(instance_id) REFERENCES instances(id)
    );

    CREATE INDEX IF NOT EXISTS idx_instances_phone ON instances(phone_number);
    CREATE INDEX IF NOT EXISTS idx_messages_instance ON inbound_messages(instance_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_origin ON inbound_messages(origin_tag, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_user ON admin_audit_logs(admin_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_instance ON admin_audit_logs(instance_id, created_at DESC);
  `);

  ensureColumnExists(db, "outbound_messages", "sent_by_user_id", "INTEGER");
  ensureColumnExists(db, "outbound_messages", "sent_by_user_name", "TEXT");
  ensureColumnExists(db, "outbound_messages", "sent_by_user_role", "TEXT");
  ensureColumnExists(db, "outbound_messages", "request_id", "TEXT");
  ensureColumnExists(db, "instances", "last_qr_payload", "TEXT");
  ensureColumnExists(db, "instances", "last_qr_at", "TEXT");

  state.db = db;
  state.statements = {
    upsertInstance: db.prepare(`
      INSERT INTO instances (
        id,
        label,
        phone_number,
        evolution_instance,
        webhook_token,
        active,
        status
      ) VALUES (
        @id,
        @label,
        @phoneNumber,
        @evolutionInstance,
        @webhookToken,
        @active,
        COALESCE(@status, 'unknown')
      )
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        phone_number = excluded.phone_number,
        evolution_instance = excluded.evolution_instance,
        webhook_token = excluded.webhook_token,
        active = excluded.active,
        status = COALESCE(excluded.status, instances.status),
        updated_at = CURRENT_TIMESTAMP
    `),
    getInstanceById: db.prepare(`
      SELECT
        id,
        label,
        phone_number AS phoneNumber,
        evolution_instance AS evolutionInstance,
        webhook_token AS webhookToken,
        active,
        status,
        last_qr_payload AS lastQrPayload,
        last_qr_at AS lastQrAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM instances
      WHERE id = ?
    `),
    getInstanceByEvolution: db.prepare(`
      SELECT
        id,
        label,
        phone_number AS phoneNumber,
        evolution_instance AS evolutionInstance,
        webhook_token AS webhookToken,
        active,
        status,
        last_qr_payload AS lastQrPayload,
        last_qr_at AS lastQrAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM instances
      WHERE evolution_instance = ?
    `),
    listInstances: db.prepare(`
      SELECT
        id,
        label,
        phone_number AS phoneNumber,
        evolution_instance AS evolutionInstance,
        webhook_token AS webhookToken,
        active,
        status,
        last_qr_payload AS lastQrPayload,
        last_qr_at AS lastQrAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM instances
      ORDER BY created_at ASC
    `),
    setInstanceStatus: db.prepare(`
      UPDATE instances
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `),
    setInstanceLatestQr: db.prepare(`
      UPDATE instances
      SET last_qr_payload = ?, last_qr_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `),
    insertInboundMessage: db.prepare(`
      INSERT OR IGNORE INTO inbound_messages (
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
      ) VALUES (
        @evolutionMessageId,
        @instanceId,
        @originTag,
        @originPhone,
        @eventName,
        @chatJid,
        @fromJid,
        @toJid,
        @fromMe,
        @messageType,
        @textBody,
        @rawPayload
      )
    `),
    insertOutboundMessage: db.prepare(`
      INSERT INTO outbound_messages (
        instance_id,
        origin_tag,
        to_jid,
        text_body,
        response_payload,
        sent_by_user_id,
        sent_by_user_name,
        sent_by_user_role,
        request_id
      ) VALUES (
        @instanceId,
        @originTag,
        @toJid,
        @textBody,
        @responsePayload,
        @sentByUserId,
        @sentByUserName,
        @sentByUserRole,
        @requestId
      )
    `),
    listMessageOrigins: db.prepare(`
      SELECT
        m.origin_tag AS originTag,
        m.instance_id AS instanceId,
        i.label AS instanceLabel,
        m.origin_phone AS originPhone,
        COUNT(*) AS totalMessages,
        MAX(m.received_at) AS lastMessageAt
      FROM inbound_messages m
      LEFT JOIN instances i ON i.id = m.instance_id
      GROUP BY m.origin_tag, m.instance_id, i.label, m.origin_phone
      ORDER BY lastMessageAt DESC
    `),
    getAdminUserByEmail: db.prepare(`
      SELECT
        id,
        name,
        email,
        password_hash AS passwordHash,
        role,
        active,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM admin_users
      WHERE email = ?
    `),
    getAdminUserById: db.prepare(`
      SELECT
        id,
        name,
        email,
        role,
        active,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM admin_users
      WHERE id = ?
    `),
    countAdminUsers: db.prepare(`
      SELECT COUNT(*) AS total
      FROM admin_users
    `),
    insertAdminUser: db.prepare(`
      INSERT INTO admin_users (
        name,
        email,
        password_hash,
        role,
        active
      ) VALUES (
        @name,
        @email,
        @passwordHash,
        COALESCE(@role, 'owner'),
        @active
      )
    `),
    insertAdminAudit: db.prepare(`
      INSERT INTO admin_audit_logs (
        admin_user_id,
        action,
        instance_id,
        target_jid,
        metadata
      ) VALUES (
        @adminUserId,
        @action,
        @instanceId,
        @targetJid,
        @metadata
      )
    `),
    listAdminAudits: db.prepare(`
      SELECT
        a.id,
        a.admin_user_id AS adminUserId,
        u.name AS adminUserName,
        u.email AS adminUserEmail,
        a.action,
        a.instance_id AS instanceId,
        a.target_jid AS targetJid,
        a.metadata,
        a.created_at AS createdAt
      FROM admin_audit_logs a
      LEFT JOIN admin_users u ON u.id = a.admin_user_id
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT @limit OFFSET @offset
    `),
    listSellerSummaries: db.prepare(`
      SELECT
        i.id AS instanceId,
        i.label AS sellerLabel,
        i.phone_number AS phoneNumber,
        i.evolution_instance AS evolutionInstance,
        i.status AS connectionStatus,
        i.active,
        COALESCE(inbound.totalInbound, 0) AS totalInbound,
        COALESCE(outbound.totalOutbound, 0) AS totalOutbound,
        COALESCE(recentInbound.totalInbound24h, 0) AS inboundLast24h,
        inbound.lastInboundAt,
        outbound.lastOutboundAt
      FROM instances i
      LEFT JOIN (
        SELECT
          instance_id,
          COUNT(*) AS totalInbound,
          MAX(received_at) AS lastInboundAt
        FROM inbound_messages
        GROUP BY instance_id
      ) inbound ON inbound.instance_id = i.id
      LEFT JOIN (
        SELECT
          instance_id,
          COUNT(*) AS totalOutbound,
          MAX(sent_at) AS lastOutboundAt
        FROM outbound_messages
        GROUP BY instance_id
      ) outbound ON outbound.instance_id = i.id
      LEFT JOIN (
        SELECT
          instance_id,
          COUNT(*) AS totalInbound24h
        FROM inbound_messages
        WHERE received_at >= datetime('now', '-1 day')
        GROUP BY instance_id
      ) recentInbound ON recentInbound.instance_id = i.id
      ORDER BY i.label ASC, i.id ASC
    `),
    deleteInboundByInstance: db.prepare(`
      DELETE FROM inbound_messages
      WHERE instance_id = ?
    `),
    deleteOutboundByInstance: db.prepare(`
      DELETE FROM outbound_messages
      WHERE instance_id = ?
    `),
    deleteAuditByInstance: db.prepare(`
      DELETE FROM admin_audit_logs
      WHERE instance_id = ?
    `),
    deleteInstanceById: db.prepare(`
      DELETE FROM instances
      WHERE id = ?
    `),
  };

  return state.db;
}

function ensureInitialized() {
  if (!state.db) {
    initializeDatabase();
  }

  return state;
}

function upsertInstance(instanceData) {
  const { statements } = ensureInitialized();
  statements.upsertInstance.run({
    ...instanceData,
    status: instanceData.status || null,
    active: instanceData.active ? 1 : 0,
  });

  return statements.getInstanceById.get(instanceData.id);
}

function getInstanceById(instanceId) {
  const { statements } = ensureInitialized();
  const row = statements.getInstanceById.get(instanceId);
  if (!row) {
    return null;
  }

  return {
    ...row,
    lastQrPayload: parseJsonSafe(row.lastQrPayload),
  };
}

function getInstanceByEvolutionInstance(evolutionInstance) {
  const { statements } = ensureInitialized();
  const row = statements.getInstanceByEvolution.get(evolutionInstance);
  if (!row) {
    return null;
  }

  return {
    ...row,
    lastQrPayload: parseJsonSafe(row.lastQrPayload),
  };
}

function listInstances() {
  const { statements } = ensureInitialized();
  return statements.listInstances.all().map((row) => ({
    ...row,
    lastQrPayload: parseJsonSafe(row.lastQrPayload),
  }));
}

function setInstanceStatus(instanceId, status) {
  const { statements } = ensureInitialized();
  statements.setInstanceStatus.run(status, instanceId);
}

function setInstanceLatestQr(instanceId, qrPayload) {
  const { statements } = ensureInitialized();
  statements.setInstanceLatestQr.run(JSON.stringify(qrPayload || {}), instanceId);
}

function saveInboundMessage(messageData) {
  const { statements } = ensureInitialized();
  const result = statements.insertInboundMessage.run(messageData);

  return {
    inserted: result.changes > 0,
    rowId: Number(result.lastInsertRowid || 0),
  };
}

function saveOutboundMessage(outboundData) {
  const { statements } = ensureInitialized();
  const result = statements.insertOutboundMessage.run({
    ...outboundData,
    sentByUserId: outboundData.sentByUserId || null,
    sentByUserName: outboundData.sentByUserName || null,
    sentByUserRole: outboundData.sentByUserRole || null,
    requestId: outboundData.requestId || null,
  });
  return Number(result.lastInsertRowid || 0);
}

function listInboundMessages(filters) {
  const { db } = ensureInitialized();
  const clauses = [];
  const params = {
    limit: Math.max(1, filters.limit || 50),
    offset: Math.max(0, filters.offset || 0),
  };

  if (filters.instanceId) {
    clauses.push("instance_id = @instanceId");
    params.instanceId = filters.instanceId;
  }

  if (filters.originTag) {
    clauses.push("origin_tag = @originTag");
    params.originTag = filters.originTag;
  }

  if (filters.receivedAfter) {
    clauses.push("received_at >= @receivedAfter");
    params.receivedAfter = filters.receivedAfter;
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const query = `
    SELECT
      id,
      evolution_message_id AS evolutionMessageId,
      instance_id AS instanceId,
      origin_tag AS originTag,
      origin_phone AS originPhone,
      event_name AS eventName,
      chat_jid AS chatJid,
      from_jid AS fromJid,
      to_jid AS toJid,
      from_me AS fromMe,
      message_type AS messageType,
      text_body AS textBody,
      received_at AS receivedAt
    FROM inbound_messages
    ${whereClause}
    ORDER BY received_at DESC, id DESC
    LIMIT @limit OFFSET @offset
  `;

  return db.prepare(query).all(params);
}

function listOrigins() {
  const { statements } = ensureInitialized();
  return statements.listMessageOrigins.all();
}

function getAdminUserByEmail(email) {
  const { statements } = ensureInitialized();
  return statements.getAdminUserByEmail.get((email || "").toLowerCase());
}

function getAdminUserById(userId) {
  const { statements } = ensureInitialized();
  return statements.getAdminUserById.get(userId);
}

function countAdminUsers() {
  const { statements } = ensureInitialized();
  const row = statements.countAdminUsers.get();
  return Number(row?.total || 0);
}

function createAdminUser(userData) {
  const { statements } = ensureInitialized();
  const result = statements.insertAdminUser.run({
    name: userData.name,
    email: userData.email.toLowerCase(),
    passwordHash: userData.passwordHash,
    role: userData.role || "owner",
    active: userData.active === false ? 0 : 1,
  });

  return getAdminUserById(Number(result.lastInsertRowid || 0));
}

function bootstrapOwnerUser(userData) {
  if (!userData.email || !userData.passwordHash) {
    return {
      created: false,
      reason: "missing_credentials",
      user: null,
    };
  }

  const existingByEmail = getAdminUserByEmail(userData.email);
  if (existingByEmail) {
    return {
      created: false,
      reason: "already_exists",
      user: existingByEmail,
    };
  }

  if (countAdminUsers() > 0) {
    return {
      created: false,
      reason: "owner_already_bootstrapped",
      user: null,
    };
  }

  const createdUser = createAdminUser({
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

function recordAdminAudit(auditData) {
  const { statements } = ensureInitialized();
  const result = statements.insertAdminAudit.run({
    adminUserId: auditData.adminUserId || null,
    action: auditData.action,
    instanceId: auditData.instanceId || null,
    targetJid: auditData.targetJid || null,
    metadata: auditData.metadata ? JSON.stringify(auditData.metadata) : null,
  });

  return Number(result.lastInsertRowid || 0);
}

function listAdminAudits(filters = {}) {
  const { db } = ensureInitialized();
  const clauses = [];
  const params = {
    limit: Math.max(1, filters.limit || 50),
    offset: Math.max(0, filters.offset || 0),
  };

  if (filters.adminUserId) {
    clauses.push("a.admin_user_id = @adminUserId");
    params.adminUserId = filters.adminUserId;
  }

  if (filters.instanceId) {
    clauses.push("a.instance_id = @instanceId");
    params.instanceId = filters.instanceId;
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const query = `
  SELECT
    a.id,
    a.admin_user_id AS adminUserId,
    u.name AS adminUserName,
    u.email AS adminUserEmail,
    a.action,
    a.instance_id AS instanceId,
    a.target_jid AS targetJid,
    a.metadata,
    a.created_at AS createdAt
  FROM admin_audit_logs a
  LEFT JOIN admin_users u ON u.id = a.admin_user_id
  ${whereClause}
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT @limit OFFSET @offset
  `;

  return db.prepare(query).all(params).map((row) => ({
    ...row,
    metadata: parseJsonSafe(row.metadata),
  }));
}

function listSellerSummaries() {
  const { statements } = ensureInitialized();
  return statements.listSellerSummaries.all().map((row) => ({
    ...row,
    active: Boolean(row.active),
  }));
}

function deleteInstancePermanently(instanceId) {
  const { db, statements } = ensureInitialized();

  const transaction = db.transaction((id) => {
    const deletedAudits = statements.deleteAuditByInstance.run(id).changes;
    const deletedInbound = statements.deleteInboundByInstance.run(id).changes;
    const deletedOutbound = statements.deleteOutboundByInstance.run(id).changes;
    const deletedInstances = statements.deleteInstanceById.run(id).changes;

    return {
      deletedAudits,
      deletedInbound,
      deletedOutbound,
      deletedInstances,
    };
  });

  return transaction(instanceId);
}

function closeDatabase() {
  if (state.db) {
    state.db.close();
    state.db = null;
    state.statements = null;
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
  closeDatabase,
};
