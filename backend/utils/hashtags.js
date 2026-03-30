import pool from "../db.js";

let hashtagSchemaReadyPromise = null;
let hashtagBackfillReadyPromise = null;

const ensureTagUniqueness = async () => {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hashtags (
      tag TEXT NOT NULL,
      post_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE hashtags
    ADD COLUMN IF NOT EXISTS tag TEXT
  `);

  await pool.query(`
    ALTER TABLE hashtags
    ADD COLUMN IF NOT EXISTS post_count INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE hashtags
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE hashtags REPLICA IDENTITY FULL
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'hashtags'
          AND column_name = 'hashtag_id'
      ) THEN
        EXECUTE 'ALTER TABLE hashtags ALTER COLUMN hashtag_id SET DEFAULT gen_random_uuid()';
      END IF;
    END $$;
  `);

  await pool.query(`
    UPDATE hashtags
    SET tag = LOWER(TRIM(tag))
    WHERE tag IS NOT NULL
      AND tag <> LOWER(TRIM(tag))
  `);

  await pool.query(`
    DELETE FROM hashtags
    WHERE tag IS NULL
       OR BTRIM(tag) = ''
  `);

  await pool.query(`
    DELETE FROM hashtags a
    USING hashtags b
    WHERE a.ctid < b.ctid
      AND a.tag = b.tag
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'hashtags_tag_unique'
      ) THEN
        ALTER TABLE hashtags
        ADD CONSTRAINT hashtags_tag_unique UNIQUE (tag);
      END IF;
    END $$;
  `);
};

let relationTablesReady = false;

const ensureRelationTables = async () => {
  if (relationTablesReady) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id UUID NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
      tag TEXT NOT NULL REFERENCES hashtags(tag) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, tag)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_hashtags (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tag TEXT NOT NULL REFERENCES hashtags(tag) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, tag)
    )
  `);

  relationTablesReady = true;
};

export const ensureHashtagSchema = async () => {
  if (!hashtagSchemaReadyPromise) {
    hashtagSchemaReadyPromise = (async () => {
      await ensureTagUniqueness();
      await ensureRelationTables();
    })().catch((error) => {
      hashtagSchemaReadyPromise = null;
      relationTablesReady = false;
      throw error;
    });
  }

  await hashtagSchemaReadyPromise;
};

export const extractHashtags = (caption = "") => {
  const matches = String(caption).match(/#[A-Za-z0-9_]+/g) || [];
  const seen = new Set();

  return matches
    .map((match) => match.slice(1).toLowerCase())
    .filter((tag) => {
      if (!tag || seen.has(tag)) {
        return false;
      }

      seen.add(tag);
      return true;
    })
    .slice(0, 25);
};

const updatePostCounts = async (client, tags) => {
  if (!tags.length) {
    return;
  }

  await client.query(
    `
    UPDATE hashtags
    SET post_count = counts.post_count
    FROM (
      SELECT tag, COUNT(*)::int AS post_count
      FROM post_hashtags
      WHERE tag = ANY($1::text[])
      GROUP BY tag
    ) counts
    WHERE hashtags.tag = counts.tag
    `,
    [tags]
  );

  await client.query(
    `
    UPDATE hashtags
    SET post_count = 0
    WHERE tag = ANY($1::text[])
      AND NOT EXISTS (
        SELECT 1
        FROM post_hashtags
        WHERE post_hashtags.tag = hashtags.tag
      )
    `,
    [tags]
  );
};

export const syncPostHashtags = async (postId, caption) => {
  await ensureHashtagSchema();

  const nextTags = extractHashtags(caption);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      "SELECT tag FROM post_hashtags WHERE post_id = $1",
      [postId]
    );

    const existingTags = existingResult.rows.map((row) => row.tag);
    const existingSet = new Set(existingTags);
    const nextSet = new Set(nextTags);

    const tagsToAdd = nextTags.filter((tag) => !existingSet.has(tag));
    const tagsToRemove = existingTags.filter((tag) => !nextSet.has(tag));

    if (tagsToAdd.length > 0) {
      await client.query(
        `
        INSERT INTO hashtags (tag)
        SELECT UNNEST($1::text[])
        ON CONFLICT (tag) DO NOTHING
        `,
        [tagsToAdd]
      );

      await client.query(
        `
        INSERT INTO post_hashtags (post_id, tag)
        SELECT $1, UNNEST($2::text[])
        ON CONFLICT (post_id, tag) DO NOTHING
        `,
        [postId, tagsToAdd]
      );
    }

    if (tagsToRemove.length > 0) {
      await client.query(
        `
        DELETE FROM post_hashtags
        WHERE post_id = $1
          AND tag = ANY($2::text[])
        `,
        [postId, tagsToRemove]
      );
    }

    await updatePostCounts(client, [...new Set([...existingTags, ...nextTags])]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const removePostHashtags = async (postId) => {
  await ensureHashtagSchema();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      "SELECT tag FROM post_hashtags WHERE post_id = $1",
      [postId]
    );

    const existingTags = existingResult.rows.map((row) => row.tag);

    await client.query("DELETE FROM post_hashtags WHERE post_id = $1", [postId]);
    await updatePostCounts(client, existingTags);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const backfillPostHashtags = async () => {
  await ensureHashtagSchema();

  if (!hashtagBackfillReadyPromise) {
    hashtagBackfillReadyPromise = (async () => {
      const { rows } = await pool.query(`
        SELECT post_id, caption
        FROM posts
        WHERE caption LIKE '%#%'
      `);

      for (const row of rows) {
        await syncPostHashtags(row.post_id, row.caption || "");
      }
    })().catch((error) => {
      hashtagBackfillReadyPromise = null;
      throw error;
    });
  }

  await hashtagBackfillReadyPromise;
};
