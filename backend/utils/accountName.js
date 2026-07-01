import pool from "../db.js";

let accountNameSchemaReadyPromise = null;

export const MAX_ACCOUNT_NAME_LENGTH = 80;

export const normalizeAccountName = (value = "") => {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, MAX_ACCOUNT_NAME_LENGTH) : null;
};

export async function ensureAccountNameSchema() {
  if (!accountNameSchemaReadyPromise) {
    accountNameSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS account_name VARCHAR(${MAX_ACCOUNT_NAME_LENGTH})
      `);
    })().catch((error) => {
      accountNameSchemaReadyPromise = null;
      throw error;
    });
  }

  await accountNameSchemaReadyPromise;
}
