import dotenv from "dotenv";
dotenv.config();
import express from "express";
import multer from "multer";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "../utils/r2.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const sanitizeFileName = (value = "") =>
  String(value)
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";

router.post("/upload-pfp", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const sanitizedOriginalName = sanitizeFileName(req.file.originalname);
    const fileExtension = sanitizedOriginalName.includes(".")
      ? sanitizedOriginalName.split(".").pop()
      : "";
    const fileName = fileExtension
      ? `pfp/${uuidv4()}.${fileExtension}`
      : `pfp/${uuidv4()}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

    res.json({
      url: publicUrl,
      key: fileName
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

export default router;
