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
    const [usersResult, postsResult, reportsResult, latestUsersResult] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total FROM users WHERE deleted_at IS NULL"),
      pool.query("SELECT COUNT(*)::int AS total FROM posts"),
      pool.query("SELECT COUNT(*)::int AS total FROM reports"),
      pool.query(
        `
        SELECT id, username, email, created_at, email_verified
        FROM users
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
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
    const { rows } = await pool.query(
      `
      SELECT id, username, email, created_at, email_verified, is_admin
           , deactivated_at
      FROM users
      WHERE deleted_at IS NULL
        AND (
          $1 = ''
          OR LOWER(username) LIKE $2
          OR LOWER(email) LIKE $2
        )
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [query, `%${query}%`]
    );

    return res.json({ users: rows });
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
            id,
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
          ORDER BY ${hasCreatedAt ? "created_at" : "id"} DESC
          LIMIT $2
          OFFSET $3
          `,
          [unresolvedOnly, limit, offset]
        )
      : await pool.query(
          `
          SELECT
            id,
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
          ORDER BY ${hasCreatedAt ? "created_at" : "id"} DESC
          LIMIT $1
          OFFSET $2
          `,
          [limit, offset]
        );

    return res.json({
      reports: rows,
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
    const { rows } = await pool.query(
      `
      UPDATE reports
      SET resolved_at = NOW(),
          resolved_by = $2,
          resolution_action = $3
      WHERE id = $1
      RETURNING id, resolved_at, resolved_by, resolution_action
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

export default router;
