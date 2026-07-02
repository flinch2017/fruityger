import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import * as tf from "@tensorflow/tfjs";
import * as nsfwjs from "nsfwjs";
import jpeg from "jpeg-js";
import ffmpegPath from "ffmpeg-static";
import pool from "../db.js";
import { moderationTextRules } from "./moderationTextRules.js";

const execFileAsync = promisify(execFile);
const REVIEW_THRESHOLD = Number(process.env.CONTENT_MODERATION_REVIEW_THRESHOLD || 0.45);
const BLOCK_THRESHOLD = Number(process.env.CONTENT_MODERATION_BLOCK_THRESHOLD || 0.82);
const FAIL_OPEN_ON_MODERATION_ERROR =
  String(process.env.CONTENT_MODERATION_FAIL_OPEN || "true").toLowerCase() !== "false";
const MAX_TEXT_PREVIEW_LENGTH = 700;
const FFMPEG_EXEC_OPTIONS = {
  maxBuffer: 10 * 1024 * 1024,
  windowsHide: true,
};

let nsfwModelPromise = null;

export class ContentModerationError extends Error {
  constructor(message, { statusCode = 400, result = null } = {}) {
    super(message);
    this.name = "ContentModerationError";
    this.statusCode = statusCode;
    this.result = result;
  }
}

function isModerationEnabled() {
  return String(process.env.CONTENT_MODERATION_ENABLED || "true").toLowerCase() !== "false";
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

function isJpegMedia(media, filePath = "") {
  const mime = String(media?.mimetype || "").toLowerCase();
  const extension = path.extname(filePath || getSafeOriginalName(media)).toLowerCase();
  return mime === "image/jpeg" || mime === "image/jpg" || extension === ".jpg" || extension === ".jpeg";
}

function getModerationErrorSummary(error) {
  return {
    code: error?.code || null,
    message: error?.message || "Unknown local moderation error",
  };
}

function getNsfwModel() {
  if (!nsfwModelPromise) {
    nsfwModelPromise = (async () => {
      tf.enableProdMode();
      await tf.ready();
      return nsfwjs.load();
    })().catch((error) => {
      nsfwModelPromise = null;
      throw error;
    });
  }

  return nsfwModelPromise;
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

async function createJpegPreview(inputPath, warnings) {
  if (!ffmpegPath) {
    warnings.push("Media moderation skipped because FFmpeg is unavailable.");
    return null;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fruityger-moderation-image-"));
  const outputPath = path.join(tempDir, "preview.jpg");

  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(640,iw)':-2",
        "-q:v",
        "5",
        outputPath,
      ],
      FFMPEG_EXEC_OPTIONS
    );

    return {
      filePath: outputPath,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const message = error?.stderr ? String(error.stderr).trim() : error?.message;
    warnings.push(`Image moderation preview failed: ${message || "unknown error"}`);
    await fs.rm(tempDir, { recursive: true, force: true });
    return null;
  }
}

async function extractVideoFramePaths(inputPath, warnings, maxFrames = 4) {
  if (!ffmpegPath) {
    warnings.push("Video moderation skipped because FFmpeg is unavailable.");
    return {
      framePaths: [],
      cleanup: async () => {},
    };
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
        inputPath,
        "-vf",
        "fps=1/10,scale='min(640,iw)':-2",
        "-frames:v",
        String(maxFrames),
        outputPattern,
      ],
      FFMPEG_EXEC_OPTIONS
    );

    const framePaths = (await fs.readdir(tempDir))
      .filter((name) => name.toLowerCase().endsWith(".jpg"))
      .sort()
      .slice(0, maxFrames)
      .map((name) => path.join(tempDir, name));

    if (framePaths.length === 0) {
      warnings.push("Video moderation did not extract any frames.");
    }

    return {
      framePaths,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const message = error?.stderr ? String(error.stderr).trim() : error?.message;
    warnings.push(`Video moderation preview failed: ${message || "unknown error"}`);
    await fs.rm(tempDir, { recursive: true, force: true });
    return {
      framePaths: [],
      cleanup: async () => {},
    };
  }
}

async function classifyJpeg(filePath) {
  const buffer = await fs.readFile(filePath);
  const decoded = jpeg.decode(buffer, { useTArray: true });
  const pixels = new Int32Array(decoded.width * decoded.height * 3);

  for (let source = 0, target = 0; source < decoded.data.length; source += 4, target += 3) {
    pixels[target] = decoded.data[source];
    pixels[target + 1] = decoded.data[source + 1];
    pixels[target + 2] = decoded.data[source + 2];
  }

  const imageTensor = tf.tensor3d(pixels, [decoded.height, decoded.width, 3], "int32");

  try {
    const model = await getNsfwModel();
    return model.classify(imageTensor);
  } finally {
    imageTensor.dispose();
  }
}

function summarizePredictions(predictions = []) {
  const scores = Object.fromEntries(
    predictions.map((prediction) => [
      String(prediction.className || "").toLowerCase(),
      Number(prediction.probability || 0),
    ])
  );

  const pornScore = Math.max(scores.porn || 0, scores.hentai || 0);
  const sexyScore = scores.sexy || 0;
  const nsfwScore = Math.max(pornScore, sexyScore);
  const blocked = pornScore >= BLOCK_THRESHOLD;
  const review = blocked || nsfwScore >= REVIEW_THRESHOLD;

  return {
    status: blocked ? "blocked" : review ? "review" : "pass",
    scores,
    nsfw_score: nsfwScore,
    porn_score: pornScore,
    sexy_score: sexyScore,
    blocked_categories: blocked ? ["pornographic_image"] : [],
    review_categories: review && !blocked ? ["suggestive_or_nsfw_image"] : [],
  };
}

function mergeMediaResults(results = []) {
  const mergedScores = {};
  const blockedCategories = new Set();
  const reviewCategories = new Set();
  let status = "pass";
  let nsfwScore = 0;

  for (const result of results) {
    if (result.status === "blocked") status = "blocked";
    if (status !== "blocked" && result.status === "review") status = "review";

    nsfwScore = Math.max(nsfwScore, result.nsfw_score || 0);

    for (const [category, score] of Object.entries(result.scores || {})) {
      mergedScores[category] = Math.max(mergedScores[category] || 0, Number(score || 0));
    }

    for (const category of result.blocked_categories || []) {
      blockedCategories.add(category);
    }

    for (const category of result.review_categories || []) {
      reviewCategories.add(category);
    }
  }

  return {
    status,
    flagged: status !== "pass",
    category_scores: mergedScores,
    nsfw_score: nsfwScore,
    blocked_categories: Array.from(blockedCategories),
    review_categories: Array.from(reviewCategories),
  };
}

function moderateText(text = "") {
  const textValue = String(text || "").trim();

  if (!textValue) {
    return {
      status: "pass",
      flagged: false,
      blocked_categories: [],
      review_categories: [],
    };
  }

  const blockedCategories = [];
  const reviewCategories = [];

  for (const rule of moderationTextRules) {
    if (!rule?.patterns?.some((pattern) => pattern.test(textValue))) {
      continue;
    }

    if (rule.action === "block") {
      blockedCategories.push(rule.category);
      continue;
    }

    reviewCategories.push(rule.category);
  }

  if (blockedCategories.length > 0 || reviewCategories.length > 0) {
    return {
      status: blockedCategories.length > 0 ? "blocked" : "review",
      flagged: true,
      blocked_categories: blockedCategories,
      review_categories: reviewCategories,
    };
  }

  return {
    status: "pass",
    flagged: false,
    blocked_categories: [],
    review_categories: [],
  };
}

function mergeTextAndMediaResults(textResult, mediaResult, warnings) {
  const status =
    textResult.status === "blocked" || mediaResult.status === "blocked"
      ? "blocked"
      : textResult.status === "review" || mediaResult.status === "review"
        ? "review"
        : "pass";

  return {
    status,
    flagged: status !== "pass",
    provider: "local-nsfwjs",
    text: textResult,
    media: mediaResult,
    category_scores: mediaResult.category_scores || {},
    nsfw_score: mediaResult.nsfw_score || 0,
    blocked_categories: [
      ...(textResult.blocked_categories || []),
      ...(mediaResult.blocked_categories || []),
    ],
    review_categories: [
      ...(textResult.review_categories || []),
      ...(mediaResult.review_categories || []),
    ],
    warnings,
  };
}

async function moderateMedia(media = []) {
  const warnings = [];
  const results = [];

  for (const item of media || []) {
    const kind = getMediaKind(item);

    if (kind !== "image" && kind !== "video") {
      continue;
    }

    const sourceFile = await getMediaFilePath(item);
    if (!sourceFile) {
      warnings.push(`Media moderation skipped for ${getSafeOriginalName(item)} because no file data was available.`);
      continue;
    }

    try {
      if (kind === "image") {
        const preview = await createJpegPreview(sourceFile.filePath, warnings);
        const fileToClassify = preview?.filePath || (isJpegMedia(item, sourceFile.filePath) ? sourceFile.filePath : null);
        if (!fileToClassify) continue;

        try {
          results.push(summarizePredictions(await classifyJpeg(fileToClassify)));
        } finally {
          await preview?.cleanup();
        }
      }

      if (kind === "video") {
        const frames = await extractVideoFramePaths(sourceFile.filePath, warnings);

        try {
          for (const framePath of frames.framePaths) {
            results.push(summarizePredictions(await classifyJpeg(framePath)));
          }
        } finally {
          await frames.cleanup();
        }
      }
    } finally {
      await sourceFile.cleanup();
    }
  }

  return {
    ...mergeMediaResults(results),
    warnings,
  };
}

export async function moderateContent({ text = "", media = [] } = {}) {
  if (!isModerationEnabled()) {
    return {
      status: "skipped",
      reason: "disabled",
      flagged: false,
    };
  }

  const textResult = moderateText(text);
  const mediaResult = await moderateMedia(media);

  return mergeTextAndMediaResults(textResult, mediaResult, mediaResult.warnings || []);
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
    console.error("Local content moderation failed:", errorSummary);

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

  const message = "This content violates our Community Guidelines and cannot be posted.";

  throw new ContentModerationError(message, {
    statusCode: 400,
    result,
  });
}
