import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { assertContentAllowedOrReport, ContentModerationError } from "../utils/contentModeration.js";

const router = express.Router();

router.post("/", authenticateToken, async (req, res) => {
  try {

    const userId = req.user.id;
    const { commentId, parentThreadId, text } = req.body;

    if (!text?.trim()) {
    return res.status(400).json({
        error: "Missing text"
    });
    }

    // Must provide either commentId OR parentThreadId
    if (!commentId && !parentThreadId) {
    return res.status(400).json({
        error: "Must provide commentId or parentThreadId"
    });
    }

    const normalizedText = text.trim();
    await assertContentAllowedOrReport({
      userId,
      contentType: "thread",
      contentId: commentId || parentThreadId,
      text: normalizedText,
      context: {
        surface: parentThreadId ? "thread_reply_create" : "thread_create",
        comment_id: commentId || null,
        parent_thread_id: parentThreadId || null,
      },
    });

    await pool.query(`
    INSERT INTO threads (
        comment_id,
        parent_thread_id,
        threader,
        thread_text
    )
    VALUES ($1, $2, $3, $4)
    `,
    [
        commentId || null,
        parentThreadId || null,
        userId,
        normalizedText
    ]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    if (err instanceof ContentModerationError) {
      return res.status(err.statusCode || 400).json({
        error: err.message,
        moderation: err.result,
      });
    }

    res.status(500).json({ error: "Server error" });
  }
});


router.get("/:commentId", authenticateToken, async (req, res) => {
  try {

    const { commentId } = req.params;

    const result = await pool.query(`
      SELECT t.*, u.username, u.profile_pic
      FROM threads t
      JOIN users u ON u.id = t.threader
      WHERE t.comment_id = $1
      ORDER BY t.created_at ASC
    `, [commentId]);

    res.json({
      replies: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;
