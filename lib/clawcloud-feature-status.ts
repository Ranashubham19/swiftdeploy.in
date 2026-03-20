import { env } from "@/lib/env";
import { isCricketAvailable } from "@/lib/clawcloud-cricket";
import { getImageGenerationStatus } from "@/lib/clawcloud-imagegen";
import {
  getGoogleWorkspaceCoreAccess,
  getGoogleWorkspaceExtendedAccess,
} from "@/lib/google-workspace-rollout";
import { isVisionAvailable } from "@/lib/clawcloud-vision";
import { isWhisperAvailable } from "@/lib/clawcloud-whisper";

export type RuntimeFeatureState = {
  available: boolean;
  reason: string | null;
  providers?: string[];
};

export type ClawCloudRuntimeFeatureStatus = {
  google_workspace_connect: RuntimeFeatureState;
  google_workspace_extended_connect: RuntimeFeatureState;
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

export function getGoogleWorkspaceConnectAvailable(userEmail?: string | null) {
  return getGoogleWorkspaceCoreAccess(userEmail).available;
}

export function getGoogleWorkspaceExtendedConnectAvailable(userEmail?: string | null) {
  return getGoogleWorkspaceExtendedAccess(userEmail).available;
}

export function getClawCloudRuntimeFeatureStatus(userEmail?: string | null): ClawCloudRuntimeFeatureStatus {
  const imageGeneration = getImageGenerationStatus();
  const googleWorkspaceAccess = getGoogleWorkspaceCoreAccess(userEmail);
  const googleWorkspaceExtendedAccess = getGoogleWorkspaceExtendedAccess(userEmail);

  return {
    google_workspace_connect: buildState(
      googleWorkspaceAccess.available,
      googleWorkspaceAccess.reason,
    ),
    google_workspace_extended_connect: buildState(
      googleWorkspaceExtendedAccess.available,
      googleWorkspaceExtendedAccess.reason,
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
