import pool from "../db.js";

let userOnboardingSchemaReadyPromise = null;

export const ensureUserOnboardingSchema = async () => {
  if (!userOnboardingSchemaReadyPromise) {
    userOnboardingSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS interests JSONB NOT NULL DEFAULT '[]'::jsonb
      `);

      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS interests_completed BOOLEAN NOT NULL DEFAULT FALSE
      `);
    })().catch((error) => {
      userOnboardingSchemaReadyPromise = null;
      throw error;
    });
  }

  await userOnboardingSchemaReadyPromise;
};

export const normalizeInterests = (interests) => {
  if (!Array.isArray(interests)) {
    return [];
  }

  const seen = new Set();

  return interests
    .map((interest) => String(interest || "").trim())
    .filter((interest) => interest.length > 0)
    .filter((interest) => {
      const key = interest.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12);
};
