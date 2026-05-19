import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { authenticateAdmin, ensureAdminSchema } from "../middleware/adminAuth.js";

const router = express.Router();

const sanitizeAdmin = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  is_admin: Boolean(user.is_admin),
});

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY || "7d",
  });

const getAdminEmails = () =>
  String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const ensureConfiguredAdmins = async () => {
  const adminEmails = getAdminEmails();
  if (adminEmails.length === 0) {
    return;
  }

  await pool.query(
    `
    UPDATE users
    SET is_admin = TRUE
    WHERE LOWER(email) = ANY($1::text[])
    `,
    [adminEmails]
  );
};

const ensureReportModerationSchema = async () => {
  await pool.query(`
    ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS resolved_by UUID
  `);
  await pool.query(`
    ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS resolution_action TEXT
  `);
};

const getReportModerationColumnsReady = async () => {
  try {
    await ensureReportModerationSchema();
    return true;
  } catch (error) {
    console.error("Report moderation schema setup failed:", error?.message || error);
    return false;
  }
};

const getReportsTableColumns = async () => {
  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reports'
    `
  );
  return new Set(rows.map((row) => String(row.column_name)));
};

const getTableColumns = async (tableName) => {
  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [String(tableName)]
  );
  return new Set(rows.map((row) => String(row.column_name)));
};

const getTableColumnMetadata = async (tableName) => {
  const { rows } = await pool.query(
    `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [String(tableName)]
  );
  return rows.map((row) => ({
    name: String(row.column_name),
    type: String(row.data_type || "").toLowerCase(),
  }));
};

const resolveUsersCreatedColumn = async () => {
  const metadata = await getTableColumnMetadata("users");
  const names = new Set(metadata.map((item) => item.name));

  if (names.has("created_at")) return "created_at";
  if (names.has("date_created")) return "date_created";
  if (names.has("date_joined")) return "date_joined";
  if (names.has("joined_at")) return "joined_at";
  if (names.has("registered_at")) return "registered_at";
  if (names.has("signup_at")) return "signup_at";
  if (names.has("signed_up_at")) return "signed_up_at";

  const dateLike = metadata.filter((item) =>
    item.type.includes("timestamp") || item.type === "date"
  );

  const preferred = dateLike.find((item) =>
    /(created|joined|register|signup|signed)/i.test(item.name)
  );

  if (preferred) {
    return preferred.name;
  }

  return null;
};

const getReportIdColumn = (columns) => {
  if (columns.has("id")) return "id";
  if (columns.has("report_id")) return "report_id";
  return null;
};

const extractLegacyMessageIdFromDetails = (details, label) => {
  const text = String(details || "");
  const regex = new RegExp(`${label}\\s*:\\s*([0-9a-fA-F-]{36})`, "i");
  const match = text.match(regex);
  return match?.[1] || null;
};

const buildReportPreview = async (report) => {
  const contentType = String(report?.content_type || "").toLowerCase();
  const contentId = String(report?.content_id || "").trim();

  if (!contentType || !contentId) {
    return null;
  }

  try {
    if (contentType === "post") {
      const { rows } = await pool.query(
        `
        SELECT
          p.caption,
          pm.media_url,
          pm.media_type
        FROM posts
        p
        LEFT JOIN LATERAL (
          SELECT media_url, media_type
          FROM post_media
          WHERE post_id = p.post_id
          ORDER BY media_order ASC
          LIMIT 1
        ) pm ON TRUE
        WHERE p.post_id::text = $1
        LIMIT 1
        `,
        [contentId]
      );
      return {
        text: rows[0]?.caption || null,
        media_url: rows[0]?.media_url || null,
        media_type: rows[0]?.media_type || null,
      };
    }

    if (contentType === "comment") {
      const { rows } = await pool.query(
        `
        SELECT content
        FROM comments
        WHERE comment_id::text = $1
        LIMIT 1
        `,
        [contentId]
      );
      return {
        text: rows[0]?.content || null,
        media_url: null,
        media_type: null,
      };
    }

    if (contentType === "message") {
      const messageColumns = await getTableColumns("messages");
      const messageTextColumn = messageColumns.has("content")
        ? "content"
        : messageColumns.has("message")
          ? "message"
          : null;
      if (!messageTextColumn) {
        return {
          text: null,
          media_url: null,
          media_type: null,
          attachment_name: null,
          attachment_mime: null,
          attachment_size: null,
        };
      }

      const fallbackMessageId = extractLegacyMessageIdFromDetails(
        report?.details,
        "Reported message ID"
      );
      const lookupId = fallbackMessageId || contentId;
      let { rows } = await pool.query(
        `
        SELECT ${messageTextColumn} AS message_text, attachment_url, attachment_type, attachment_name, attachment_mime, attachment_size
        FROM messages
        WHERE id::text = $1
        LIMIT 1
        `,
        [lookupId]
      );

      if (!rows[0]) {
        rows = (
          await pool.query(
            `
            SELECT ${messageTextColumn} AS message_text, attachment_url, attachment_type, attachment_name, attachment_mime, attachment_size
            FROM messages
            WHERE chat_id::text = $1
              AND sender_id::text <> $2
              AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz)
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [contentId, String(report?.reporter_id || ""), report?.created_at || null]
          )
        ).rows;
      }

      return {
        text: rows[0]?.message_text || null,
        media_url: rows[0]?.attachment_url || null,
        media_type: rows[0]?.attachment_type || null,
        attachment_name: rows[0]?.attachment_name || null,
        attachment_mime: rows[0]?.attachment_mime || null,
        attachment_size: rows[0]?.attachment_size || null,
      };
    }

    if (contentType === "group_message") {
      const groupMessageColumns = await getTableColumns("group_messages");
      const groupMessageTextColumn = groupMessageColumns.has("content")
        ? "content"
        : groupMessageColumns.has("message")
          ? "message"
          : null;
      if (!groupMessageTextColumn) {
        return {
          text: null,
          media_url: null,
          media_type: null,
          attachment_name: null,
          attachment_mime: null,
          attachment_size: null,
        };
      }

      const fallbackMessageId = extractLegacyMessageIdFromDetails(
        report?.details,
        "Reported group message ID"
      );
      const lookupId = fallbackMessageId || contentId;
      let { rows } = await pool.query(
        `
        SELECT ${groupMessageTextColumn} AS message_text, attachment_url, attachment_type, attachment_name, attachment_mime, attachment_size
        FROM group_messages
        WHERE id::text = $1
        LIMIT 1
        `,
        [lookupId]
      );

      if (!rows[0]) {
        rows = (
          await pool.query(
            `
            SELECT ${groupMessageTextColumn} AS message_text, attachment_url, attachment_type, attachment_name, attachment_mime, attachment_size
            FROM group_messages
            WHERE group_chat_id::text = $1
              AND sender_id::text <> $2
              AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz)
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [contentId, String(report?.reporter_id || ""), report?.created_at || null]
          )
        ).rows;
      }

      return {
        text: rows[0]?.message_text || null,
        media_url: rows[0]?.attachment_url || null,
        media_type: rows[0]?.attachment_type || null,
        attachment_name: rows[0]?.attachment_name || null,
        attachment_mime: rows[0]?.attachment_mime || null,
        attachment_size: rows[0]?.attachment_size || null,
      };
    }
  } catch (error) {
    console.error("Failed to build report preview:", error?.message || error);
  }

  return {
    text: null,
    media_url: null,
    media_type: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_size: null,
  };
};

const ensureAdminActivitySchema = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_activity_logs (
      id UUID PRIMARY KEY,
      admin_id UUID NOT NULL,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const ensureHelpRequestsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS help_requests (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_response TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ
    )
  `);
};

const logAdminActivity = async ({ adminId, actionType, targetType, targetId, metadata = {} }) => {
  await ensureAdminActivitySchema();
  await pool.query(
    `
    INSERT INTO admin_activity_logs (id, admin_id, action_type, target_type, target_id, metadata)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [uuidv4(), adminId, actionType, targetType, String(targetId), JSON.stringify(metadata)]
  );
};

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const identifier = String(email || "").trim().toLowerCase();

  if (!identifier || !password) {
    return res.status(400).json({ error: "Email/username and password are required" });
  }

  await ensureAdminSchema();
  await ensureConfiguredAdmins();

  try {
    const { rows } = await pool.query(
      `
      SELECT id, username, email, password, is_admin, deactivated_at, deleted_at
      FROM users
      WHERE LOWER(email) = $1 OR LOWER(username) = $1
      LIMIT 1
      `,
      [identifier]
    );

    const user = rows[0];
    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    if (user.deactivated_at || user.deleted_at) {
      return res.status(403).json({ error: "Account unavailable" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    if (!user.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    return res.json({
      token: signToken(user.id),
      admin: sanitizeAdmin(user),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/session", authenticateAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, username, email, is_admin
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.admin.id]
    );

    if (!rows[0]) {
      return res.status(401).json({ error: "User not found" });
    }

    return res.json({ admin: sanitizeAdmin(rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard", authenticateAdmin, async (req, res) => {
  try {
    const usersCreatedColumn = await resolveUsersCreatedColumn();
    const usersCreatedSelect = usersCreatedColumn
      ? `${usersCreatedColumn} AS created_at`
      : "NULL::timestamptz AS created_at";
    const usersOrderBy = usersCreatedColumn ? usersCreatedColumn : "id";

    const [usersResult, postsResult, reportsResult, latestUsersResult] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total FROM users WHERE deleted_at IS NULL"),
      pool.query("SELECT COUNT(*)::int AS total FROM posts"),
      pool.query("SELECT COUNT(*)::int AS total FROM reports"),
      pool.query(
        `
        SELECT id, username, email, ${usersCreatedSelect}, email_verified
        FROM users
        WHERE deleted_at IS NULL
        ORDER BY ${usersOrderBy} DESC
        LIMIT 8
        `
      ),
    ]);

    return res.json({
      stats: {
        users: usersResult.rows[0]?.total || 0,
        posts: postsResult.rows[0]?.total || 0,
        reports: reportsResult.rows[0]?.total || 0,
      },
      createdAtSource: usersCreatedColumn || null,
      latestUsers: latestUsersResult.rows,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

router.get("/users", authenticateAdmin, async (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();

  try {
    const usersCreatedColumn = await resolveUsersCreatedColumn();
    const usersCreatedSelect = usersCreatedColumn
      ? `${usersCreatedColumn} AS created_at`
      : "NULL::timestamptz AS created_at";
    const usersOrderBy = usersCreatedColumn ? usersCreatedColumn : "id";

    const { rows } = await pool.query(
      `
      SELECT id, username, email, ${usersCreatedSelect}, email_verified, is_admin
           , deactivated_at
      FROM users
      WHERE deleted_at IS NULL
        AND (
          $1 = ''
          OR LOWER(username) LIKE $2
          OR LOWER(email) LIKE $2
        )
      ORDER BY ${usersOrderBy} DESC
      LIMIT 100
      `,
      [query, `%${query}%`]
    );

    return res.json({ users: rows, createdAtSource: usersCreatedColumn || null });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load users" });
  }
});

router.get("/reports", authenticateAdmin, async (req, res) => {
  const moderationColumnsReady = await getReportModerationColumnsReady();
  const unresolvedOnly = String(req.query.unresolved || "").toLowerCase() === "true";
  const page = Math.max(Number.parseInt(String(req.query.page || "1"), 10) || 1, 1);
  const limitRaw = Number.parseInt(String(req.query.limit || "20"), 10) || 20;
  const limit = Math.min(Math.max(limitRaw, 1), 100);
  const offset = (page - 1) * limit;

  try {
    const tableExistsResult = await pool.query(`SELECT to_regclass('public.reports') AS reports_table`);
    if (!tableExistsResult.rows[0]?.reports_table) {
      return res.json({
        reports: [],
        pagination: { page, limit, total: 0, totalPages: 1 },
        filters: { unresolvedOnly: false, moderationColumnsReady: false },
      });
    }

    const reportColumns = await getReportsTableColumns();
    const reportIdColumn = getReportIdColumn(reportColumns);
    if (!reportIdColumn) {
      return res.status(500).json({ error: "Reports table is missing a primary id column" });
    }
    const hasReporterId = reportColumns.has("reporter_id");
    const hasContentType = reportColumns.has("content_type");
    const hasContentId = reportColumns.has("content_id");
    const hasReason = reportColumns.has("reason");
    const hasDetails = reportColumns.has("details");
    const hasCreatedAt = reportColumns.has("created_at");
    const hasResolvedAt = moderationColumnsReady && reportColumns.has("resolved_at");
    const hasResolvedBy = moderationColumnsReady && reportColumns.has("resolved_by");
    const hasResolutionAction = moderationColumnsReady && reportColumns.has("resolution_action");

    const countResult = moderationColumnsReady
      ? await pool.query(
          `
          SELECT COUNT(*)::int AS total
          FROM reports
          WHERE ($1::boolean = FALSE OR resolved_at IS NULL)
          `,
          [unresolvedOnly]
        )
      : await pool.query(`SELECT COUNT(*)::int AS total FROM reports`);

    const { rows } = moderationColumnsReady
      ? await pool.query(
          `
          SELECT
            ${reportIdColumn}::text AS id,
            ${hasReporterId ? "reporter_id" : "NULL::uuid AS reporter_id"},
            ${hasContentType ? "content_type" : "NULL::text AS content_type"},
            ${hasContentId ? "content_id" : "NULL::text AS content_id"},
            ${hasReason ? "reason" : "NULL::text AS reason"},
            ${hasDetails ? "details" : "NULL::text AS details"},
            ${hasCreatedAt ? "created_at" : "NOW()::timestamptz AS created_at"},
            ${hasResolvedAt ? "resolved_at" : "NULL::timestamptz AS resolved_at"},
            ${hasResolvedBy ? "resolved_by" : "NULL::uuid AS resolved_by"},
            ${hasResolutionAction ? "resolution_action" : "NULL::text AS resolution_action"}
          FROM reports
          WHERE ($1::boolean = FALSE OR ${hasResolvedAt ? "resolved_at IS NULL" : "TRUE"})
          ORDER BY ${hasCreatedAt ? "created_at" : reportIdColumn} DESC
          LIMIT $2
          OFFSET $3
          `,
          [unresolvedOnly, limit, offset]
        )
      : await pool.query(
          `
          SELECT
            ${reportIdColumn}::text AS id,
            ${hasReporterId ? "reporter_id" : "NULL::uuid AS reporter_id"},
            ${hasContentType ? "content_type" : "NULL::text AS content_type"},
            ${hasContentId ? "content_id" : "NULL::text AS content_id"},
            ${hasReason ? "reason" : "NULL::text AS reason"},
            ${hasDetails ? "details" : "NULL::text AS details"},
            ${hasCreatedAt ? "created_at" : "NOW()::timestamptz AS created_at"},
            NULL::timestamptz AS resolved_at,
            NULL::uuid AS resolved_by,
            NULL::text AS resolution_action
          FROM reports
          ORDER BY ${hasCreatedAt ? "created_at" : reportIdColumn} DESC
          LIMIT $1
          OFFSET $2
          `,
          [limit, offset]
        );

    const reports = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        preview: await buildReportPreview(row),
      }))
    );

    return res.json({
      reports,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.max(Math.ceil((countResult.rows[0]?.total || 0) / limit), 1),
      },
      filters: {
        unresolvedOnly: moderationColumnsReady ? unresolvedOnly : false,
        moderationColumnsReady,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load reports" });
  }
});

router.patch("/users/:userId/ban", authenticateAdmin, async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: "User id is required" });
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE users
      SET deactivated_at = NOW()
      WHERE id = $1
      RETURNING id, username, email, is_admin, deactivated_at
      `,
      [userId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }
    await logAdminActivity({
      adminId: req.admin.id,
      actionType: "ban_user",
      targetType: "user",
      targetId: userId,
      metadata: { username: rows[0].username },
    });

    return res.json({ user: rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to ban user" });
  }
});

router.patch("/users/:userId/unban", authenticateAdmin, async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: "User id is required" });
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE users
      SET deactivated_at = NULL
      WHERE id = $1
      RETURNING id, username, email, is_admin, deactivated_at
      `,
      [userId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }
    await logAdminActivity({
      adminId: req.admin.id,
      actionType: "unban_user",
      targetType: "user",
      targetId: userId,
      metadata: { username: rows[0].username },
    });

    return res.json({ user: rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to unban user" });
  }
});

router.patch("/reports/:reportId/resolve", authenticateAdmin, async (req, res) => {
  const { reportId } = req.params;
  const action = String(req.body?.action || "resolved").trim().toLowerCase();

  const moderationColumnsReady = await getReportModerationColumnsReady();
  if (!moderationColumnsReady) {
    return res.status(503).json({ error: "Report moderation columns are not available yet" });
  }

  try {
    const reportColumns = await getReportsTableColumns();
    const reportIdColumn = getReportIdColumn(reportColumns);
    if (!reportIdColumn) {
      return res.status(500).json({ error: "Reports table is missing a primary id column" });
    }

    const { rows } = await pool.query(
      `
      UPDATE reports
      SET resolved_at = NOW(),
          resolved_by = $2,
          resolution_action = $3
      WHERE ${reportIdColumn}::text = $1
      RETURNING ${reportIdColumn}::text AS id, resolved_at, resolved_by, resolution_action
      `,
      [reportId, req.admin.id, action]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Report not found" });
    }
    await logAdminActivity({
      adminId: req.admin.id,
      actionType: "resolve_report",
      targetType: "report",
      targetId: reportId,
      metadata: { resolution_action: action },
    });

    return res.json({ report: rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to resolve report" });
  }
});

router.delete("/posts/:postId", authenticateAdmin, async (req, res) => {
  const { postId } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const postResult = await client.query(
      `
      SELECT post_id
      FROM posts
      WHERE post_id = $1
      LIMIT 1
      `,
      [postId]
    );

    if (!postResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Post not found" });
    }

    await client.query("DELETE FROM post_media WHERE post_id = $1", [postId]);
    await client.query("DELETE FROM reports WHERE content_type = 'post' AND content_id = $1", [postId]);
    await client.query("DELETE FROM posts WHERE post_id = $1", [postId]);

    await client.query("COMMIT");
    await logAdminActivity({
      adminId: req.admin.id,
      actionType: "delete_post",
      targetType: "post",
      targetId: postId,
    });
    return res.json({ success: true, deletedPostId: postId });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    console.error(error);
    return res.status(500).json({ error: "Failed to delete post" });
  } finally {
    client.release();
  }
});

router.get("/activity", authenticateAdmin, async (req, res) => {
  const page = Math.max(Number.parseInt(String(req.query.page || "1"), 10) || 1, 1);
  const limitRaw = Number.parseInt(String(req.query.limit || "20"), 10) || 20;
  const limit = Math.min(Math.max(limitRaw, 1), 100);
  const offset = (page - 1) * limit;

  await ensureAdminActivitySchema();

  try {
    const countResult = await pool.query("SELECT COUNT(*)::int AS total FROM admin_activity_logs");
    const { rows } = await pool.query(
      `
      SELECT
        l.id,
        l.admin_id,
        u.username AS admin_username,
        u.email AS admin_email,
        l.action_type,
        l.target_type,
        l.target_id,
        l.metadata,
        l.created_at
      FROM admin_activity_logs l
      LEFT JOIN users u ON u.id = l.admin_id
      ORDER BY l.created_at DESC
      LIMIT $1
      OFFSET $2
      `,
      [limit, offset]
    );

    return res.json({
      logs: rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.max(Math.ceil((countResult.rows[0]?.total || 0) / limit), 1),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load activity logs" });
  }
});

router.get("/help-requests", authenticateAdmin, async (req, res) => {
  const statusFilter = String(req.query.status || "").trim().toLowerCase();

  try {
    await ensureHelpRequestsTable();
    const { rows } = await pool.query(
      `
      SELECT
        hr.id,
        hr.user_id,
        u.username,
        u.email,
        hr.subject,
        hr.message,
        hr.status,
        hr.admin_response,
        hr.created_at,
        hr.updated_at,
        hr.responded_at
      FROM help_requests hr
      JOIN users u ON u.id = hr.user_id
      WHERE ($1 = '' OR LOWER(hr.status) = $1)
      ORDER BY hr.created_at DESC
      LIMIT 200
      `,
      [statusFilter]
    );

    return res.json({ requests: rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load help requests" });
  }
});

router.patch("/help-requests/:requestId", authenticateAdmin, async (req, res) => {
  const { requestId } = req.params;
  const nextStatus = String(req.body?.status || "").trim().toLowerCase();
  const adminResponse = String(req.body?.adminResponse || "").trim();
  const allowedStatus = new Set(["open", "in_progress", "resolved"]);

  if (!allowedStatus.has(nextStatus)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  try {
    await ensureHelpRequestsTable();
    const { rows } = await pool.query(
      `
      UPDATE help_requests
      SET status = $2,
          admin_response = CASE
            WHEN $3 = '' THEN admin_response
            ELSE $3
          END,
          updated_at = NOW(),
          responded_at = CASE
            WHEN $3 = '' THEN responded_at
            ELSE NOW()
          END
      WHERE id::text = $1
      RETURNING id, status, admin_response, updated_at, responded_at
      `,
      [requestId, nextStatus, adminResponse]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Help request not found" });
    }

    await logAdminActivity({
      adminId: req.admin.id,
      actionType: "update_help_request",
      targetType: "help_request",
      targetId: requestId,
      metadata: {
        status: nextStatus,
        responded: Boolean(adminResponse),
      },
    });

    return res.json({ request: rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to update help request" });
  }
});

export default router;
