import pool from "../db.js";
import { createNotification } from "./notifications.js";

let mentionsSchemaReadyPromise = null;

const MENTION_REGEX = /@([A-Za-z0-9._]+)/g;

export const extractMentionUsernames = (caption = "") => {
  const seen = new Set();
  const matches = String(caption || "").match(MENTION_REGEX) || [];

  return matches
    .map((entry) => entry.slice(1).toLowerCase())
    .filter((username) => {
      if (!username || seen.has(username)) return false;
      seen.add(username);
      return true;
    });
};

export const ensurePostMentionsSchema = async () => {
  if (!mentionsSchemaReadyPromise) {
    mentionsSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS post_mentions (
          post_id UUID NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (post_id, user_id)
        )
      `);
    })().catch((error) => {
      mentionsSchemaReadyPromise = null;
      throw error;
    });
  }

  await mentionsSchemaReadyPromise;
};

export const syncPostMentions = async (postId, caption, actorId) => {
  await ensurePostMentionsSchema();

  const usernames = extractMentionUsernames(caption);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `SELECT user_id FROM post_mentions WHERE post_id = $1`,
      [postId]
    );
    const existingUserIds = existingResult.rows.map((row) => row.user_id);

    let mentionedUsers = [];
    if (usernames.length > 0) {
      const userResult = await client.query(
        `
        SELECT id, username
        FROM users
        WHERE LOWER(username) = ANY($1::text[])
          AND deactivated_at IS NULL
          AND deleted_at IS NULL
        `,
        [usernames]
      );
      mentionedUsers = userResult.rows.filter((user) => String(user.id) !== String(actorId));
    }

    const nextUserIds = mentionedUsers.map((user) => user.id);
    const existingSet = new Set(existingUserIds.map(String));
    const nextSet = new Set(nextUserIds.map(String));

    const toAdd = nextUserIds.filter((id) => !existingSet.has(String(id)));
    const toRemove = existingUserIds.filter((id) => !nextSet.has(String(id)));

    if (toAdd.length > 0) {
      await client.query(
        `
        INSERT INTO post_mentions (post_id, user_id)
        SELECT $1, UNNEST($2::uuid[])
        ON CONFLICT (post_id, user_id) DO NOTHING
        `,
        [postId, toAdd]
      );
    }

    if (toRemove.length > 0) {
      await client.query(
        `
        DELETE FROM post_mentions
        WHERE post_id = $1
          AND user_id = ANY($2::uuid[])
        `,
        [postId, toRemove]
      );
    }

    await client.query("COMMIT");

    for (const recipientId of toAdd) {
      await createNotification({
        recipientId,
        actorId,
        type: "post_mention",
        postId,
      });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
