import express from "express";
import pool from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { ensureRepostSchema } from "../utils/reposts.js";
import { createNotification } from "../utils/notifications.js";
import { canViewUserActivity, ensurePrivateAccountSchema } from "../utils/privacy.js";

const router = express.Router();

router.post("/toggle", authenticateToken, async (req, res) => {
  const { postId } = req.body || {};
  const userId = req.user.id;

  if (!postId) {
    return res.status(400).json({ error: "postId is required" });
  }

  try {
    await ensureRepostSchema();
    await ensurePrivateAccountSchema();

    const postResult = await pool.query(
      `
      SELECT post_id, user_id
      FROM posts
      WHERE post_id = $1
      LIMIT 1
      `,
      [postId]
    );

    const post = postResult.rows[0];
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (!(await canViewUserActivity(userId, post.user_id))) {
      return res.status(403).json({ error: "This post is private" });
    }

    if (post.user_id === userId) {
      return res.status(400).json({ error: "You cannot repost your own post" });
    }

    const existingResult = await pool.query(
      `
      SELECT 1
      FROM reposts
      WHERE user_id = $1
        AND post_id = $2
      LIMIT 1
      `,
      [userId, postId]
    );

    let reposted = false;

    if (existingResult.rows.length > 0) {
      await pool.query(
        `
        DELETE FROM reposts
        WHERE user_id = $1
          AND post_id = $2
        `,
        [userId, postId]
      );
    } else {
      await pool.query(
        `
        INSERT INTO reposts (user_id, post_id)
        VALUES ($1, $2)
        `,
        [userId, postId]
      );
      reposted = true;

      await createNotification({
        recipientId: post.user_id,
        actorId: userId,
        type: "post_repost",
        postId,
      });
    }

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS repost_count
      FROM reposts
      WHERE post_id = $1
      `,
      [postId]
    );

    res.json({
      reposted,
      repost_count: countResult.rows[0]?.repost_count || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to repost post" });
  }
});

export default router;
