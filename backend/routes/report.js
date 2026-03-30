import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

router.post("/submit", authenticateToken, async (req, res) => {
  const { contentType, contentId, reason, details } = req.body;
  const reporterId = req.user.id;

  try {
    if (!contentType || !contentId || !reason) {
      return res.status(400).json({ error: "contentType, contentId, and reason are required" });
    }

    const query = `
      INSERT INTO reports (reporter_id, content_type, content_id, reason, details)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [
      reporterId,
      contentType,
      contentId,
      reason,
      details || null
    ]);

    res.status(201).json({ report: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit report" });
  }
});

export default router; 
