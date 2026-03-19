import { env } from "@/lib/env";
import { isCricketAvailable } from "@/lib/clawcloud-cricket";
import { getImageGenerationStatus } from "@/lib/clawcloud-imagegen";
import { isVisionAvailable } from "@/lib/clawcloud-vision";
import { isWhisperAvailable } from "@/lib/clawcloud-whisper";

export type RuntimeFeatureState = {
  available: boolean;
  reason: string | null;
  providers?: string[];
};

export type ClawCloudRuntimeFeatureStatus = {
  google_workspace_connect: RuntimeFeatureState;
  whatsapp_agent: RuntimeFeatureState;
  telegram_bot: RuntimeFeatureState;
  voice_transcription: RuntimeFeatureState;
  image_analysis: RuntimeFeatureState;
  image_generation: RuntimeFeatureState;
  cricket_live: RuntimeFeatureState;
  train_live: RuntimeFeatureState;
};

function buildState(
  available: boolean,
  reason: string | null,
  providers?: string[],
): RuntimeFeatureState {
  return {
    available,
    reason: available ? null : reason,
    ...(providers && providers.length ? { providers } : {}),
  };
}

export function getGoogleWorkspaceConnectAvailable() {
  return Boolean(
    env.GOOGLE_WORKSPACE_PUBLIC_ENABLED
    && !env.GOOGLE_WORKSPACE_TEMPORARY_HOLD
    && env.GOOGLE_CLIENT_ID
    && env.GOOGLE_CLIENT_SECRET
    && env.NEXT_PUBLIC_APP_URL,
  );
}

export function getClawCloudRuntimeFeatureStatus(): ClawCloudRuntimeFeatureStatus {
  const imageGeneration = getImageGenerationStatus();

  return {
    google_workspace_connect: buildState(
      getGoogleWorkspaceConnectAvailable(),
      "Google OAuth is disabled or not fully configured for public Workspace connect.",
    ),
    whatsapp_agent: buildState(
      Boolean((env.AGENT_SERVER_URL || env.BACKEND_API_URL) && env.AGENT_SECRET),
      "WhatsApp agent server is not fully configured yet.",
    ),
    telegram_bot: buildState(
      Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME),
      "Telegram bot token or username is missing.",
    ),
    voice_transcription: buildState(
      isWhisperAvailable(),
      "Add GROQ_API_KEY or OPENAI_API_KEY to enable voice transcription.",
    ),
    image_analysis: buildState(
      isVisionAvailable(),
      "Add NVIDIA_API_KEY or OPENAI_API_KEY to enable image analysis.",
    ),
    image_generation: buildState(
      imageGeneration.available,
      "No image generation provider is available.",
      imageGeneration.providers,
    ),
    cricket_live: buildState(
      isCricketAvailable(),
      "Add CRICAPI_KEY to enable live cricket scores.",
    ),
    train_live: buildState(
      Boolean(process.env.RAPIDAPI_KEY?.trim()),
      "Add RAPIDAPI_KEY to enable live train and PNR status.",
    ),
  };
}
