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

const TAPE_STICKER_DISPLAY = {
  sparkle: "*",
  heart: "<3",
  star: "+",
  bubble: "o",
  flower: "@",
  fire: "^",
};

const clampNumber = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
};

const normalizeTapeEdits = (value) => {
  if (!value) {
    return null;
  }

  const edits = typeof value === "string" ? JSON.parse(value) : value;
  if (!edits || typeof edits !== "object") {
    return null;
  }

  const sourceFrame = edits.sourceFrame && typeof edits.sourceFrame === "object"
    ? {
        width: clampNumber(edits.sourceFrame.width, 240, 2160, 390),
        height: clampNumber(edits.sourceFrame.height, 320, 3840, 693),
      }
    : { width: 390, height: 693 };

  const textOverlays = Array.isArray(edits.textOverlays)
    ? edits.textOverlays
        .filter((item) => item && typeof item.text === "string" && item.text.trim())
        .slice(0, 12)
        .map((item, index) => {
          const transform = item.transform && typeof item.transform === "object" ? item.transform : {};
          return {
            text: item.text.trim().slice(0, 180),
            transform: {
              translateX: clampNumber(transform.translateX, -sourceFrame.width, sourceFrame.width, 0),
              translateY: clampNumber(transform.translateY, -sourceFrame.height, sourceFrame.height, index * 34),
              scale: clampNumber(transform.scale, 0.45, 3, 1),
              rotate: clampNumber(transform.rotate, -180, 180, 0),
            },
          };
        })
    : [];

  const sticker = typeof edits.sticker === "string" ? TAPE_STICKER_DISPLAY[edits.sticker] || "" : "";
  const stickerTransform = edits.stickerTransform && typeof edits.stickerTransform === "object"
    ? edits.stickerTransform
    : {};
  const trimStartMillis = clampNumber(edits.trimStartMillis, 0, Number.MAX_SAFE_INTEGER, 0);
  const rawTrimEndMillis = Number(edits.trimEndMillis);
  const trimEndMillis =
    Number.isFinite(rawTrimEndMillis) && rawTrimEndMillis > trimStartMillis + 500 ? rawTrimEndMillis : 0;
  const audioStartMillis = clampNumber(edits.audioStartMillis, 0, Number.MAX_SAFE_INTEGER, 0);

  return {
    sourceFrame,
    textOverlays,
    sticker,
    stickerTransform: {
      translateX: clampNumber(stickerTransform.translateX, -sourceFrame.width, sourceFrame.width, sourceFrame.width * 0.22),
      translateY: clampNumber(stickerTransform.translateY, -sourceFrame.height, sourceFrame.height, -sourceFrame.height * 0.22),
      scale: clampNumber(stickerTransform.scale, 0.45, 3, 1),
      rotate: clampNumber(stickerTransform.rotate, -180, 180, -8),
    },
    trimStartMillis,
    trimEndMillis,
    audioStartMillis,
    muteOriginalAudio: Boolean(edits.muteOriginalAudio),
  };
};

const hasRenderableTapeEdits = (edits) =>
  Boolean(edits && (edits.textOverlays.length > 0 || edits.sticker));

const hasTimingTapeEdits = (edits) =>
  Boolean(edits && (edits.trimStartMillis > 0 || edits.trimEndMillis > 0 || edits.muteOriginalAudio));

const escapeAssText = (value) =>
  String(value)
    .replace(/[{}]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\N");

const formatAssNumber = (value) => Number(value).toFixed(2).replace(/\.00$/, "");

const buildAssDialogue = ({ text, transform, sourceFrame, fontSize, bold = true }) => {
  const x = sourceFrame.width / 2 + transform.translateX;
  const y = sourceFrame.height / 2 + transform.translateY;
  const scale = transform.scale * 100;
  const rotate = transform.rotate;
  const tags = [
    "\\an5",
    `\\pos(${formatAssNumber(x)},${formatAssNumber(y)})`,
    `\\fs${formatAssNumber(fontSize)}`,
    `\\fscx${formatAssNumber(scale)}`,
    `\\fscy${formatAssNumber(scale)}`,
    `\\frz${formatAssNumber(rotate)}`,
    "\\bord3",
    "\\shad2",
    "\\c&HFFFFFF&",
    "\\3c&H1A1A1A&",
    bold ? "\\b1" : "\\b0",
  ].join("");

  return `Dialogue: 0,0:00:00.00,9:59:59.99,Default,,0,0,0,,{${tags}}${escapeAssText(text)}`;
};

const createTapeEditsAssFile = async (tempDir, edits) => {
  const assPath = path.join(tempDir, "tape-edits.ass");
  const { sourceFrame } = edits;
  const events = [
    ...edits.textOverlays.map((item) =>
      buildAssDialogue({
        text: item.text,
        transform: item.transform,
        sourceFrame,
        fontSize: 30,
      })
    ),
  ];

  if (edits.sticker) {
    events.push(
      buildAssDialogue({
        text: edits.sticker,
        transform: edits.stickerTransform,
        sourceFrame,
        fontSize: 46,
      })
    );
  }

  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${Math.round(sourceFrame.width)}`,
    `PlayResY: ${Math.round(sourceFrame.height)}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,30,&H00FFFFFF,&H000000FF,&H801A1A1A,&H60000000,-1,0,0,0,100,100,0,0,1,3,2,5,20,20,20,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");

  await fs.writeFile(assPath, ass, "utf8");
  return assPath;
};

const escapeFilterPath = (filePath) =>
  filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");

const getTranscodeArgs = ({
  inputPath,
  outputPath,
  videoFilter,
  audioInputPath,
  videoStartSeconds = 0,
  durationSeconds = 0,
  audioStartSeconds = 0,
  muteOriginalAudio = false,
  mixOriginalAudio = false,
}) => {
  const hasExternalAudio = Boolean(audioInputPath);
  const shouldTrimExternalAudio = hasExternalAudio && audioStartSeconds > 0;
  const externalAudioFilterInput = shouldTrimExternalAudio ? "[music_trimmed]" : "[1:a:0]";
  const externalAudioMap = shouldTrimExternalAudio ? "[music_trimmed]" : "1:a:0";
  const filterComplexParts = [
    ...(shouldTrimExternalAudio
      ? [`[1:a:0]atrim=start=${audioStartSeconds},asetpts=PTS-STARTPTS[music_trimmed]`]
      : []),
    ...(mixOriginalAudio
      ? [`[0:a:0]${externalAudioFilterInput}amix=inputs=2:duration=shortest:dropout_transition=0[aout]`]
      : []),
  ];

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...(videoStartSeconds > 0 ? ["-ss", String(videoStartSeconds)] : []),
    "-i",
    inputPath,
    ...(hasExternalAudio ? ["-stream_loop", "-1", "-i", audioInputPath] : []),
    "-map",
    "0:v:0",
    ...(videoFilter ? ["-vf", videoFilter] : []),
    ...(filterComplexParts.length > 0 ? ["-filter_complex", filterComplexParts.join(";")] : []),
    ...(mixOriginalAudio
      ? ["-map", "[aout]"]
      : hasExternalAudio
        ? ["-map", externalAudioMap]
        : muteOriginalAudio
          ? []
          : ["-map", "0:a?"]),
    ...(durationSeconds > 0 ? ["-t", String(durationSeconds)] : []),
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
    ...(hasExternalAudio || durationSeconds > 0 ? ["-shortest"] : []),
    "-movflags",
    "+faststart",
    outputPath,
  ];
};

const videoHasAudioStream = async (inputPath) => {
  try {
    await execFileAsync(ffmpegPath, ["-hide_banner", "-i", inputPath], FFMPEG_EXEC_OPTIONS);
    return false;
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr) : "";
    return /Audio:/i.test(stderr);
  }
};

const runVideoTranscode = async ({
  inputPath,
  outputPath,
  videoFilter,
  audioInputPath,
  videoStartSeconds,
  durationSeconds,
  audioStartSeconds,
  muteOriginalAudio,
  mixOriginalAudio,
}) => {
  try {
    await execFileAsync(
      ffmpegPath,
      getTranscodeArgs({
        inputPath,
        outputPath,
        videoFilter,
        audioInputPath,
        videoStartSeconds,
        durationSeconds,
        audioStartSeconds,
        muteOriginalAudio,
        mixOriginalAudio,
      }),
      FFMPEG_EXEC_OPTIONS
    );
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : "";
    const ffmpegMessage = stderr.split("\n").slice(-3).join(" ").trim();
    throw new Error(ffmpegMessage || "Video transcoding failed");
  }
};

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

    await runVideoTranscode({ inputPath, outputPath });

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
    await runVideoTranscode({ inputPath, outputPath });

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

export async function burnTapeEditsIntoVideoFile(inputPath, originalName = "video", rawTapeEdits = null, audioInputPath = null) {
  if (!ffmpegPath) {
    throw new Error("FFmpeg binary is not available");
  }

  let edits = null;
  try {
    edits = normalizeTapeEdits(rawTapeEdits);
  } catch {
    edits = null;
  }

  if (!hasRenderableTapeEdits(edits) && !hasTimingTapeEdits(edits) && !audioInputPath) {
    return transcodeVideoFileToMp4(inputPath, originalName);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fruityger-tape-render-"));
  const inputExt = path.extname(originalName) || path.extname(inputPath) || ".mov";
  const baseName = sanitizeBaseName(path.basename(originalName, inputExt));
  const outputPath = path.join(tempDir, `${baseName}.mp4`);
  const videoStartSeconds = edits?.trimStartMillis ? Number((edits.trimStartMillis / 1000).toFixed(3)) : 0;
  const durationSeconds =
    edits?.trimEndMillis && edits.trimEndMillis > edits.trimStartMillis
      ? Number(((edits.trimEndMillis - edits.trimStartMillis) / 1000).toFixed(3))
      : 0;
  const audioStartSeconds = edits?.audioStartMillis ? Number((edits.audioStartMillis / 1000).toFixed(3)) : 0;
  const muteOriginalAudio = Boolean(edits?.muteOriginalAudio);

  try {
    const assPath = hasRenderableTapeEdits(edits) ? await createTapeEditsAssFile(tempDir, edits) : null;
    const mixOriginalAudio =
      Boolean(audioInputPath) && !muteOriginalAudio && (await videoHasAudioStream(inputPath));
    await runVideoTranscode({
      inputPath,
      outputPath,
      videoFilter: assPath ? `subtitles='${escapeFilterPath(assPath)}'` : undefined,
      audioInputPath,
      videoStartSeconds,
      durationSeconds,
      audioStartSeconds,
      muteOriginalAudio,
      mixOriginalAudio,
    });

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

export async function createVideoThumbnailFile(inputPath, originalName = "video") {
  if (!ffmpegPath) {
    throw new Error("FFmpeg binary is not available");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fruityger-video-thumb-"));
  const inputExt = path.extname(originalName) || path.extname(inputPath) || ".mp4";
  const baseName = sanitizeBaseName(path.basename(originalName, inputExt));
  const outputPath = path.join(tempDir, `${baseName}-thumbnail.jpg`);

  try {
    try {
      await execFileAsync(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2:force_original_aspect_ratio=decrease",
        "-q:v",
        "5",
        outputPath,
      ], FFMPEG_EXEC_OPTIONS);
    } catch (error) {
      const stderr = error?.stderr ? String(error.stderr).trim() : "";
      const ffmpegMessage = stderr.split("\n").slice(-3).join(" ").trim();
      throw new Error(ffmpegMessage || "Video thumbnail generation failed");
    }

    return {
      outputPath,
      mimetype: "image/jpeg",
      fileName: `${baseName}-thumbnail.jpg`,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}
