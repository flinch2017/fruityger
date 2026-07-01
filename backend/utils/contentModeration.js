import axios from "axios";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import pool from "../db.js";

const execFileAsync = promisify(execFile);
const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";
const MODERATION_MODEL = process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest";
const REVIEW_THRESHOLD = Number(process.env.CONTENT_MODERATION_REVIEW_THRESHOLD || 0.35);
const BLOCK_THRESHOLD = Number(process.env.CONTENT_MODERATION_BLOCK_THRESHOLD || 0.85);
const FAIL_OPEN_ON_MODERATION_ERROR =
  String(process.env.CONTENT_MODERATION_FAIL_OPEN || "true").toLowerCase() !== "false";
const MAX_IMAGE_BYTES_FOR_DIRECT_DATA_URL = 4 * 1024 * 1024;
const MAX_TEXT_PREVIEW_LENGTH = 700;
const FFMPEG_EXEC_OPTIONS = {
  maxBuffer: 10 * 1024 * 1024,
  windowsHide: true,
};

const BLOCK_CATEGORIES = new Set(["sexual/minors"]);
const REVIEW_CATEGORIES = new Set([
  "sexual",
  "sexual/minors",
  "violence/graphic",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
]);

export class ContentModerationError extends Error {
  constructor(message, { statusCode = 400, result = null } = {}) {
    super(message);
    this.name = "ContentModerationError";
    this.statusCode = statusCode;
    this.result = result;
  }
}

function isModerationEnabled() {
  const configured = String(process.env.CONTENT_MODERATION_ENABLED || "true").toLowerCase();
  return configured !== "false" && Boolean(process.env.OPENAI_API_KEY);
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getModerationErrorSummary(error) {
  const responseData = error?.response?.data;
  const responseError = responseData?.error || responseData;

  return {
    status: error?.response?.status || null,
    code: responseError?.code || error?.code || null,
    type: responseError?.type || null,
    message: responseError?.message || error?.message || "Unknown moderation error",
  };
}

function getMediaKind(media) {
  const explicitKind = String(media?.kind || "").toLowerCase();
  const mime = String(media?.mimetype || "").toLowerCase();

  if (explicitKind === "image" || mime.startsWith("image/")) return "image";
  if (explicitKind === "video" || mime.startsWith("video/")) return "video";
  return "other";
}

function getSafeOriginalName(media) {
  return String(media?.originalName || media?.originalname || media?.fileName || "upload");
}

function buildDataUrl(buffer, mimetype) {
  return `data:${mimetype};base64,${buffer.toString("base64")}`;
}

async function createTempFileFromBuffer(buffer, originalName = "upload") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fruityger-moderation-"));
  const ext = path.extname(originalName) || ".bin";
  const filePath = path.join(tempDir, `input${ext}`);
  await fs.writeFile(filePath, buffer);

  return {
    filePath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function getMediaFilePath(media) {
  if (media?.filePath) {
    return {
      filePath: media.filePath,
      cleanup: async () => {},
    };
  }

  if (media?.buffer) {
    return createTempFileFromBuffer(media.buffer, getSafeOriginalName(media));
  }

  return null;
}

async function convertImageToModerationDataUrl(filePath, mimetype, warnings) {
  const resolvedMime = String(mimetype || "image/jpeg").toLowerCase();
  const stats = await fs.stat(filePath).catch(() => null);

  if (!ffmpegPath && stats && stats.size <= MAX_IMAGE_BYTES_FOR_DIRECT_DATA_URL) {
    const buffer = await fs.readFile(filePath);
    return buildDataUrl(buffer, resolvedMime);
  }

  if (!ffmpegPath) {
    warnings.push("Image moderation skipped because FFmpeg is unavailable and the image is too large.");
    return null;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fruityger-moderation-image-"));
  const outputPath = path.join(tempDir, "moderation.jpg");

  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        filePath,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(1024,iw)':-2",
        "-q:v",
        "5",
        outputPath,
      ],
      FFMPEG_EXEC_OPTIONS
    );

    const buffer = await fs.readFile(outputPath);
    return buildDataUrl(buffer, "image/jpeg");
  } catch (error) {
    const message = error?.stderr ? String(error.stderr).trim() : error?.message;
    warnings.push(`Image moderation preview failed: ${message || "unknown error"}`);

    if (stats && stats.size <= MAX_IMAGE_BYTES_FOR_DIRECT_DATA_URL) {
      const buffer = await fs.readFile(filePath);
      return buildDataUrl(buffer, resolvedMime);
    }

    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractVideoFrameDataUrls(filePath, warnings, maxFrames = 4) {
  if (!ffmpegPath) {
    warnings.push("Video moderation skipped because FFmpeg is unavailable.");
    return [];
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fruityger-moderation-video-"));
  const outputPattern = path.join(tempDir, "frame-%03d.jpg");

  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        filePath,
        "-vf",
        "fps=1/10,scale='min(768,iw)':-2",
        "-frames:v",
        String(maxFrames),
        outputPattern,
      ],
      FFMPEG_EXEC_OPTIONS
    );

    const frameNames = (await fs.readdir(tempDir))
      .filter((name) => name.toLowerCase().endsWith(".jpg"))
      .sort()
      .slice(0, maxFrames);

    const frames = [];

    for (const frameName of frameNames) {
      const buffer = await fs.readFile(path.join(tempDir, frameName));
      frames.push(buildDataUrl(buffer, "image/jpeg"));
    }

    if (frames.length === 0) {
      warnings.push("Video moderation did not extract any frames.");
    }

    return frames;
  } catch (error) {
    const message = error?.stderr ? String(error.stderr).trim() : error?.message;
    warnings.push(`Video moderation preview failed: ${message || "unknown error"}`);
    return [];
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function buildModerationInput({ text = "", media = [] }) {
  const input = [];
  const warnings = [];
  const textValue = String(text || "").trim();

  if (textValue) {
    input.push({ type: "text", text: textValue });
  }

  for (const item of media || []) {
    const kind = getMediaKind(item);

    if (kind !== "image" && kind !== "video") {
      continue;
    }

    const file = await getMediaFilePath(item);
    if (!file) {
      warnings.push(`Media moderation skipped for ${getSafeOriginalName(item)} because no file data was available.`);
      continue;
    }

    try {
      if (kind === "image") {
        const imageUrl = await convertImageToModerationDataUrl(file.filePath, item?.mimetype, warnings);
        if (imageUrl) {
          input.push({ type: "image_url", image_url: { url: imageUrl } });
        }
      }

      if (kind === "video") {
        const frameUrls = await extractVideoFrameDataUrls(file.filePath, warnings);
        for (const frameUrl of frameUrls) {
          input.push({ type: "image_url", image_url: { url: frameUrl } });
        }
      }
    } finally {
      await file.cleanup();
    }
  }

  return { input, warnings };
}

function summarizeModerationResults(results = []) {
  const categories = {};
  const categoryScores = {};
  let flagged = false;

  for (const result of results) {
    flagged = flagged || Boolean(result?.flagged);

    for (const [category, value] of Object.entries(result?.categories || {})) {
      categories[category] = Boolean(categories[category] || value);
    }

    for (const [category, value] of Object.entries(result?.category_scores || {})) {
      categoryScores[category] = Math.max(normalizeNumber(categoryScores[category]), normalizeNumber(value));
    }
  }

  const blockedCategories = Object.keys(categories).filter((category) => {
    if (BLOCK_CATEGORIES.has(category) && categories[category]) return true;
    return normalizeNumber(categoryScores[category]) >= BLOCK_THRESHOLD;
  });

  const reviewCategories = Object.keys(categoryScores).filter((category) => {
    if (blockedCategories.includes(category)) return false;
    if (REVIEW_CATEGORIES.has(category) && categories[category]) return true;
    return REVIEW_CATEGORIES.has(category) && normalizeNumber(categoryScores[category]) >= REVIEW_THRESHOLD;
  });

  const status =
    blockedCategories.length > 0 ? "blocked" : reviewCategories.length > 0 || flagged ? "review" : "pass";

  return {
    status,
    flagged,
    categories,
    category_scores: categoryScores,
    blocked_categories: blockedCategories,
    review_categories: reviewCategories,
  };
}

export async function moderateContent({ text = "", media = [] } = {}) {
  if (!isModerationEnabled()) {
    return {
      status: "skipped",
      reason: process.env.OPENAI_API_KEY ? "disabled" : "missing_openai_api_key",
      flagged: false,
    };
  }

  const { input, warnings } = await buildModerationInput({ text, media });

  if (input.length === 0) {
    return {
      status: "pass",
      flagged: false,
      warnings,
    };
  }

  const { data } = await axios.post(
    OPENAI_MODERATION_URL,
    {
      model: MODERATION_MODEL,
      input,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  return {
    ...summarizeModerationResults(data?.results || []),
    model: data?.model || MODERATION_MODEL,
    warnings,
  };
}

async function createModerationReport({
  reporterId,
  contentType,
  contentId,
  reason,
  details,
}) {
  try {
    await pool.query(
      `
      INSERT INTO reports (reporter_id, content_type, content_id, reason, details)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [reporterId, contentType, contentId, reason, details]
    );
  } catch (error) {
    console.error("Failed to create automated moderation report:", error);
  }
}

export async function assertContentAllowedOrReport({
  userId,
  contentType,
  contentId,
  text = "",
  media = [],
  context = {},
} = {}) {
  let result;

  try {
    result = await moderateContent({ text, media });
  } catch (error) {
    const errorSummary = getModerationErrorSummary(error);
    console.error("OpenAI moderation request failed:", errorSummary);

    const details = JSON.stringify({
      status: "moderation_failed",
      error: errorSummary,
      context,
    });

    await createModerationReport({
      reporterId: userId,
      contentType,
      contentId,
      reason: "automated_content_moderation_failed",
      details,
    });

    if (FAIL_OPEN_ON_MODERATION_ERROR) {
      return {
        status: "skipped",
        reason: "moderation_failed",
        flagged: false,
        error: errorSummary,
      };
    }

    throw new ContentModerationError("Content safety check failed. Please try again.", {
      statusCode: 503,
      result: { status: "failed" },
    });
  }

  if (result.status === "pass" || result.status === "skipped") {
    return result;
  }

  const details = JSON.stringify({
    status: result.status === "blocked" ? "blocked" : "pending_review",
    moderation: result,
    text_preview: String(text || "").slice(0, MAX_TEXT_PREVIEW_LENGTH),
    media_count: Array.isArray(media) ? media.length : 0,
    context,
  });

  await createModerationReport({
    reporterId: userId,
    contentType,
    contentId,
    reason: "automated_content_moderation",
    details,
  });

  const message =
    result.status === "blocked"
      ? "This content appears to violate our safety rules and cannot be posted."
      : "This content needs moderator review before it can be posted.";

  throw new ContentModerationError(message, {
    statusCode: 400,
    result,
  });
}
