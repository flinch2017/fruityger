import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
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
  try {
    const { rows } = await pool.query(
      `
      SELECT id, reporter_id, content_type, content_id, reason, details, created_at
      FROM reports
      ORDER BY created_at DESC
      LIMIT 100
      `
    );

    return res.json({ reports: rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load reports" });
  }
});

export default router;
