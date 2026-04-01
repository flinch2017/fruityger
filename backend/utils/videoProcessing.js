import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const FFMPEG_EXEC_OPTIONS = {
  maxBuffer: 10 * 1024 * 1024,
  windowsHide: true,
};

const sanitizeBaseName = (value = "") =>
  String(value)
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "video";

export async function transcodeVideoToMp4(fileBuffer, originalName = "video") {
  if (!ffmpegPath) {
    throw new Error("FFmpeg binary is not available");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fruityger-video-"));
  const inputExt = path.extname(originalName) || ".mov";
  const baseName = sanitizeBaseName(path.basename(originalName, inputExt));
  const inputPath = path.join(tempDir, `input${inputExt}`);
  const outputPath = path.join(tempDir, `${baseName}.mp4`);

  try {
    await fs.writeFile(inputPath, fileBuffer);

    try {
      await execFileAsync(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-tag:v",
        "avc1",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputPath,
      ], FFMPEG_EXEC_OPTIONS);
    } catch (error) {
      const stderr = error?.stderr ? String(error.stderr).trim() : "";
      const ffmpegMessage = stderr.split("\n").slice(-3).join(" ").trim();
      throw new Error(ffmpegMessage || "Video transcoding failed");
    }

    const outputBuffer = await fs.readFile(outputPath);

    return {
      buffer: outputBuffer,
      mimetype: "video/mp4",
      fileName: `${baseName}.mp4`,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function transcodeVideoFileToMp4(inputPath, originalName = "video") {
  if (!ffmpegPath) {
    throw new Error("FFmpeg binary is not available");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fruityger-video-"));
  const inputExt = path.extname(originalName) || path.extname(inputPath) || ".mov";
  const baseName = sanitizeBaseName(path.basename(originalName, inputExt));
  const outputPath = path.join(tempDir, `${baseName}.mp4`);

  try {
    try {
      await execFileAsync(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-tag:v",
        "avc1",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputPath,
      ], FFMPEG_EXEC_OPTIONS);
    } catch (error) {
      const stderr = error?.stderr ? String(error.stderr).trim() : "";
      const ffmpegMessage = stderr.split("\n").slice(-3).join(" ").trim();
      throw new Error(ffmpegMessage || "Video transcoding failed");
    }

    return {
      outputPath,
      mimetype: "video/mp4",
      fileName: `${baseName}.mp4`,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}
