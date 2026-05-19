import jwt from "jsonwebtoken";
import pool from "../db.js";

let adminSchemaReadyPromise = null;

const ensureAdminSchema = async () => {
  if (!adminSchemaReadyPromise) {
    adminSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE
      `);

      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS admin_banned_at TIMESTAMPTZ
      `);
    })().catch((error) => {
      adminSchemaReadyPromise = null;
      throw error;
    });
  }

  await adminSchemaReadyPromise;
};

export const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    await ensureAdminSchema();

    const { rows } = await pool.query(
      `
      SELECT id, username, email, is_admin, deactivated_at, deleted_at, admin_banned_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [decoded.id]
    );

    const admin = rows[0];

    if (!admin) {
      return res.status(401).json({ error: "User not found" });
    }

    if (admin.admin_banned_at || admin.deactivated_at || admin.deleted_at) {
      return res.status(403).json({ error: "Account unavailable" });
    }

    if (!admin.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.admin = {
      id: admin.id,
      username: admin.username,
      email: admin.email,
    };

    return next();
  } catch (error) {
    return res.status(403).json({ error: "Invalid token" });
  }
};

export { ensureAdminSchema };
