import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { buildVideoQuestionPrompt } from "@/lib/clawcloud-media-context";
import { logClawCloudProviderEvent } from "@/lib/clawcloud-provider-telemetry";
import { analyseImage, isVisionAvailable } from "@/lib/clawcloud-vision";
import { isWhisperAvailable, transcribeAudioBuffer } from "@/lib/clawcloud-whisper";

const execFile = promisify(execFileCallback);
const VIDEO_PROCESS_TIMEOUT_MS = 25_000;
type BuildVideoPromptInput = {
  videoBuffer: Buffer;
  mimeType: string;
  caption?: string | null;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getFfmpegBinary(): string | null {
  const fromEnv = process.env.FFMPEG_BIN?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  return typeof ffmpegPath === "string" && ffmpegPath.trim()
    ? ffmpegPath
    : null;
}

function mimeTypeToExtension(mimeType: string): string {
  const lower = mimeType.toLowerCase();

  if (lower.includes("quicktime")) return "mov";
  if (lower.includes("webm")) return "webm";
  if (lower.includes("x-matroska")) return "mkv";
  if (lower.includes("3gpp")) return "3gp";
  return "mp4";
}

async function runFfmpeg(ffmpegBinary: string, args: string[]): Promise<boolean> {
  try {
    await execFile(ffmpegBinary, args, {
      timeout: VIDEO_PROCESS_TIMEOUT_MS,
      windowsHide: true,
    });
    return true;
  } catch (error) {
    logClawCloudProviderEvent("warn", "video", "ffmpeg_failed", {
      error: error instanceof Error ? error.message : String(error),
      args: args.join(" ").slice(0, 240),
    });
    return false;
  }
}

async function extractVideoAudio(
  ffmpegBinary: string,
  inputPath: string,
  outputPath: string,
): Promise<Buffer | null> {
  const ok = await runFfmpeg(ffmpegBinary, [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    outputPath,
  ]);

  if (!ok || !(await fileExists(outputPath))) {
    return null;
  }

  return readFile(outputPath).catch(() => null);
}

async function extractVideoFrame(
  ffmpegBinary: string,
  inputPath: string,
  outputPath: string,
): Promise<Buffer | null> {
  const ok = await runFfmpeg(ffmpegBinary, [
    "-y",
    "-ss",
    "00:00:01",
    "-i",
    inputPath,
    "-frames:v",
    "1",
    outputPath,
  ]);

  if (!ok || !(await fileExists(outputPath))) {
    return null;
  }

  return readFile(outputPath).catch(() => null);
}

export function isVideoProcessingAvailable(): boolean {
  return Boolean(getFfmpegBinary() && (isWhisperAvailable() || isVisionAvailable()));
}

export async function buildVideoPromptFromMedia({
  videoBuffer,
  mimeType,
  caption,
}: BuildVideoPromptInput): Promise<string | null> {
  const ffmpegBinary = getFfmpegBinary();
  if (!ffmpegBinary) {
    logClawCloudProviderEvent("warn", "video", "provider_unavailable", {
      reason: "missing_ffmpeg_binary",
    });
    return null;
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), "clawcloud-video-"));
  const inputPath = path.join(workDir, `input.${mimeTypeToExtension(mimeType)}`);
  const audioPath = path.join(workDir, "audio.mp3");
  const framePath = path.join(workDir, "frame.png");

  try {
    await writeFile(inputPath, videoBuffer);

    const [audioBuffer, frameBuffer] = await Promise.all([
      isWhisperAvailable()
        ? extractVideoAudio(ffmpegBinary, inputPath, audioPath)
        : Promise.resolve(null),
      isVisionAvailable()
        ? extractVideoFrame(ffmpegBinary, inputPath, framePath)
        : Promise.resolve(null),
    ]);

    const [transcript, frameAnalysis] = await Promise.all([
      audioBuffer ? transcribeAudioBuffer(audioBuffer, "audio/mpeg") : Promise.resolve(null),
      frameBuffer
        ? analyseImage(
          frameBuffer,
          "image/png",
          "Describe only what is visible in this video frame and quote any readable text. Do not infer unseen motion.",
        )
        : Promise.resolve(null),
    ]);

    const prompt = buildVideoQuestionPrompt({
      mimeType,
      transcript,
      frameAnalysis,
      userQuestion: caption?.trim() ?? "",
    });

    logClawCloudProviderEvent(prompt ? "info" : "warn", "video", prompt ? "video_processed" : "video_processing_empty", {
      hasTranscript: Boolean(transcript),
      hasFrameAnalysis: Boolean(frameAnalysis),
      mimeType,
    });

    return prompt;
  } catch (error) {
    logClawCloudProviderEvent("error", "video", "video_processing_failed", {
      error: error instanceof Error ? error.message : String(error),
      mimeType,
    });
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => null);
  }
}
