import dotenv from "dotenv";
dotenv.config();

import pool from "./db.js";

pool.query("SELECT NOW()")
  .then(res => {
    console.log("✅ Connected to DB:", res.rows[0]);
    pool.end(); // close the connection
  })
  .catch(err => {
    console.error("❌ DB connection error:", err);
    pool.end();
  });