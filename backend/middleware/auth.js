import jwt from "jsonwebtoken";
import pool from "../db.js";
import { ensureEmailVerificationSchema } from "../utils/emailVerification.js";

const resolveAuth = async (req, res, next, { requireVerified }) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    await ensureEmailVerificationSchema();

    const { rows } = await pool.query(
      `
      SELECT id, username, email, email_verified
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [decoded.id]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = { id: user.id, username: user.username, email: user.email };
    req.authUser = user;

    if (requireVerified && !user.email_verified) {
      return res.status(403).json({ error: "Email not verified", requiresVerification: true });
    }

    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }
};

export function authenticateToken(req, res, next) {
  return resolveAuth(req, res, next, { requireVerified: true });
}

export function authenticateTokenAllowUnverified(req, res, next) {
  return resolveAuth(req, res, next, { requireVerified: false });
}
