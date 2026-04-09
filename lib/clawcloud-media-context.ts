const MAX_MEDIA_CONTEXT_CHARS = 6_000;

export const MEDIA_CONTEXT_MARKER_START = "--- Media evidence ---";
export const MEDIA_CONTEXT_MARKER_END = "--- End of media evidence ---";

type MediaFailureReason =
  | "analysis_failed"
  | "download_failed"
  | "provider_unavailable";

function trimMediaEvidence(text: string, maxChars = MAX_MEDIA_CONTEXT_CHARS) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function buildVoiceNoteQuestionPrompt(
  transcript: string,
  userQuestion?: string | null,
) {
  const trimmedTranscript = trimMediaEvidence(transcript, 5_000);
  const trimmedQuestion = String(userQuestion ?? "").trim();

  return [
    "User sent a voice note.",
    "",
    MEDIA_CONTEXT_MARKER_START,
    "Source: voice note transcript",
    trimmedTranscript,
    MEDIA_CONTEXT_MARKER_END,
    "",
    trimmedQuestion
      ? `User request about this voice note: ${trimmedQuestion}`
      : "Please answer using only the transcript above. If any wording seems unclear or incomplete, say that briefly instead of guessing.",
  ].join("\n");
}

export function buildVoiceNoteGroundingFailureReply(input: {
  userQuestion?: string | null;
  reason: MediaFailureReason;
}) {
  const hadQuestion = Boolean(String(input.userQuestion ?? "").trim());

  if (input.reason === "download_failed") {
    return hadQuestion
      ? "I received your voice note and your question, but I could not download the audio reliably. I will not guess from partial audio. Please resend the voice note or type the exact part you want me to answer."
      : "I received your voice note, but I could not download the audio reliably. Please resend it or type the exact part you want me to answer.";
  }

  if (input.reason === "provider_unavailable") {
    return hadQuestion
      ? "I received your voice note and your question, but transcription is not available on this deployment right now. I am not going to guess from the audio alone. Please resend it later or type the exact line or question you want me to answer."
      : "I received your voice note, but transcription is not available on this deployment right now. Please resend it later or type the exact line or question you want me to answer.";
  }

  return hadQuestion
    ? "I received your voice note and your question, but I could not extract a reliable enough transcript to answer accurately. I am not going to guess from unclear audio. Please resend the voice note or type the exact line or question you want me to answer."
    : "I received your voice note, but I could not extract a reliable enough transcript to answer accurately. Please resend it or type the exact line or question you want me to answer.";
}

export function buildVideoQuestionPrompt(input: {
  mimeType: string;
  transcript?: string | null;
  frameAnalysis?: string | null;
  userQuestion?: string | null;
}) {
  const transcript = String(input.transcript ?? "").trim();
  const frameAnalysis = String(input.frameAnalysis ?? "").trim();
  const trimmedQuestion = String(input.userQuestion ?? "").trim();

  if (!transcript && !frameAnalysis) {
    return null;
  }

  return [
    "User sent a video.",
    `Type: ${input.mimeType}`,
    "",
    MEDIA_CONTEXT_MARKER_START,
    transcript ? `Audio transcript:\n${trimMediaEvidence(transcript, 5_000)}` : "",
    frameAnalysis
      ? `Representative frame evidence:\n${trimMediaEvidence(frameAnalysis, 2_800)}`
      : "",
    MEDIA_CONTEXT_MARKER_END,
    "",
    trimmedQuestion
      ? `User question about this video: ${trimmedQuestion}`
      : "Please summarize this video using only the transcript and frame evidence above. If motion or context is unclear from the available evidence, say that briefly instead of guessing.",
  ].filter(Boolean).join("\n\n");
}

export function looksLikeGroundedMediaPrompt(text: string) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return false;
  }

  return (
    trimmed.includes(MEDIA_CONTEXT_MARKER_START)
    || trimmed.includes(MEDIA_CONTEXT_MARKER_END)
    || /\buser (?:request|question) about this (?:voice note|video):/i.test(trimmed)
    || /\buser sent a voice note\./i.test(trimmed)
    || /\buser sent a video\./i.test(trimmed)
  );
}

export function buildImageGroundingFailureReply(input: {
  userQuestion?: string | null;
  reason: MediaFailureReason;
}) {
  const hadQuestion = Boolean(String(input.userQuestion ?? "").trim());

  if (input.reason === "download_failed") {
    return hadQuestion
      ? "I received your image and your question, but I could not download the image content reliably. I will not guess from the caption alone. Please resend the image or send a clearer crop of the part you want me to check."
      : "I received your image, but I could not download the image content reliably. Please resend it or send a clearer crop of the part you want me to check.";
  }

  if (input.reason === "provider_unavailable") {
    return hadQuestion
      ? "I received your image and your question, but image analysis is not available on this deployment right now. I will not answer from the caption alone. Please resend the image later, or describe the exact text or area you want checked."
      : "I received your image, but image analysis is not available on this deployment right now. Please resend it later, or describe the exact text or area you want checked.";
  }

  return hadQuestion
    ? "I received your image and your question, but I could not read enough reliable detail from the image to answer accurately. I am not going to guess from the caption alone. Please resend a clearer image or zoom into the exact area you want me to analyze."
    : "I received your image, but I could not read enough reliable detail to answer accurately. Please resend a clearer image or zoom into the exact area you want me to analyze.";
}

export function buildVideoGroundingFailureReply(input: {
  userQuestion?: string | null;
  reason: MediaFailureReason;
}) {
  const hadQuestion = Boolean(String(input.userQuestion ?? "").trim());

  if (input.reason === "download_failed") {
    return hadQuestion
      ? "I received your video and your question, but I could not download the video content reliably. I will not guess from the caption alone. Please resend the video, send the key frame as an image, or send the audio as a voice note."
      : "I received your video, but I could not download the video content reliably. Please resend the video, send the key frame as an image, or send the audio as a voice note.";
  }

  if (input.reason === "provider_unavailable") {
    return hadQuestion
      ? "I received your video and your question, but video analysis is not available on this deployment right now. I will not answer from the caption alone. Please resend it later, send the key frame as an image, or send the audio as a voice note."
      : "I received your video, but video analysis is not available on this deployment right now. Please resend it later, send the key frame as an image, or send the audio as a voice note.";
  }

  return hadQuestion
    ? "I received your video and your question, but I could not extract enough reliable audio or visual evidence to answer accurately. I am not going to guess from the caption alone. Please resend the video, send the key frame as an image, or send the audio as a voice note."
    : "I received your video, but I could not extract enough reliable audio or visual evidence to answer accurately. Please resend the video, send the key frame as an image, or send the audio as a voice note.";
}
