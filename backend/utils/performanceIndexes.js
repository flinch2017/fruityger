import pool from "../db.js";

let performanceIndexesReadyPromise = null;

export async function ensurePerformanceIndexes() {
  if (!performanceIndexesReadyPromise) {
    performanceIndexesReadyPromise = (async () => {
      const statements = [
        `CREATE INDEX IF NOT EXISTS idx_posts_user_date_posted ON posts(user_id, date_posted DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_posts_date_posted ON posts(date_posted DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_post_media_post_id_order ON post_media(post_id, media_order ASC)`,
        `CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id)`,
        `CREATE INDEX IF NOT EXISTS idx_likes_liker_post ON likes(liker, post_id)`,
        `CREATE INDEX IF NOT EXISTS idx_reposts_post_id_created_at ON reposts(post_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_reposts_user_id_created_at ON reposts(user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_comments_post_id_created_at ON comments(post_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_comments_parent_comment_id ON comments(parent_comment_id)`,
        `CREATE INDEX IF NOT EXISTS idx_follows_follower_following ON follows(follower_id, following_id)`,
        `CREATE INDEX IF NOT EXISTS idx_follows_following_follower ON follows(following_id, follower_id)`,
        `CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications(user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_notifications_user_read_status ON notifications(user_id, read_status)`,
        `CREATE INDEX IF NOT EXISTS idx_messages_chat_created_at ON messages(chat_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_messages_receiver_read_status ON messages(receiver_id, read_status, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_messages_sender_chat_created_at ON messages(sender_id, chat_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_chats_user1_id ON chats(user1_id)`,
        `CREATE INDEX IF NOT EXISTS idx_chats_user2_id ON chats(user2_id)`,
        `CREATE INDEX IF NOT EXISTS idx_deleted_messages_user_message ON deleted_messages(user_id, message_id)`,
        `CREATE INDEX IF NOT EXISTS idx_deleted_chats_user_chat_deleted_at ON deleted_chats(user_id, chat_id, deleted_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_active_users_last_seen_at ON active_users(last_seen_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker_blocked ON blocked_users(blocker_id, blocked_id)`,
        `CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked_blocker ON blocked_users(blocked_id, blocker_id)`,
        `CREATE INDEX IF NOT EXISTS idx_hashtags_tag ON hashtags(tag)`,
        `CREATE INDEX IF NOT EXISTS idx_post_hashtags_post_id ON post_hashtags(post_id)`,
        `CREATE INDEX IF NOT EXISTS idx_post_hashtags_hashtag_id ON post_hashtags(hashtag_id)`,
      ];

      for (const statement of statements) {
        await pool.query(statement);
      }
    })().catch((error) => {
      performanceIndexesReadyPromise = null;
      throw error;
    });
  }

  await performanceIndexesReadyPromise;
}
