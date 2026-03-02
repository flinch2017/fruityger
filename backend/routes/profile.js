// routes/profile.js
import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// Protect this route
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, email, profile_pic, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;