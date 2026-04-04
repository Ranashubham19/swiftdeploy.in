import type { GlobalLiteConnection } from "@/lib/clawcloud-global-lite";
import type { ClawCloudWhatsAppRuntimeStatus } from "@/lib/clawcloud-whatsapp-runtime";
import { pickAuthoritativeClawCloudWhatsAppAccount } from "@/lib/clawcloud-whatsapp-account-selection";

export type SetupConnectedAccount = {
  provider: string;
  account_email?: string | null;
  phone_number?: string | null;
  display_name?: string | null;
  is_active: boolean;
  connected_at?: string | null;
  last_used_at?: string | null;
};

export type ClawCloudSetupStatusSnapshot = {
  connected_accounts?: SetupConnectedAccount[] | null;
  global_lite_connections?: GlobalLiteConnection[] | null;
  whatsapp_connected?: boolean;
  whatsapp_phone?: string | null;
  whatsapp_runtime?: ClawCloudWhatsAppRuntimeStatus | null;
};

type SetupCallbackProcessingOptions = {
  authProvider: string | null;
  gmailLiteConnectedFromSearch: boolean;
  driveLiteConnectedFromSearch: boolean;
  globalConnectBootstrap: boolean;
  gmailConnectedFromSearch: boolean;
  calendarConnectedFromSearch: boolean;
  driveConnectedFromSearch: boolean;
  activationFromSearch: boolean;
  setupError: string | null;
  authAccessTokenAvailable: boolean;
  isCheckingSession: boolean;
};

type SetupGoogleWorkspaceAvailabilityOptions = {
  setupLiteMode: boolean;
  publicWorkspaceEnabled: boolean;
  publicWorkspaceExtendedEnabled: boolean;
  coreAccessAllowed: boolean;
  extendedAccessAllowed: boolean;
};

function listActiveAccounts(accounts: SetupConnectedAccount[] | null | undefined) {
  return (accounts ?? []).filter((account) => account.is_active);
}

export function deriveClawCloudSetupConnectionState(
  snapshot: ClawCloudSetupStatusSnapshot,
) {
  const activeAccounts = listActiveAccounts(snapshot.connected_accounts);
  const providers = new Set(activeAccounts.map((account) => account.provider));
  const whatsappAccount = pickAuthoritativeClawCloudWhatsAppAccount(
    activeAccounts.filter((account) => account.provider === "whatsapp"),
  );

  return {
    gmailConnected: providers.has("gmail"),
    calendarConnected: providers.has("google_calendar"),
    driveConnected: providers.has("google_drive"),
    whatsappConnected: Boolean(snapshot.whatsapp_connected) || Boolean(whatsappAccount),
    whatsappPhone: snapshot.whatsapp_phone ?? whatsappAccount?.phone_number ?? null,
    globalLiteConnections: snapshot.global_lite_connections ?? [],
    activeAccounts,
  };
}

export function deriveClawCloudSetupGoogleWorkspaceAvailability({
  setupLiteMode,
  publicWorkspaceEnabled,
  publicWorkspaceExtendedEnabled,
  coreAccessAllowed,
  extendedAccessAllowed,
}: SetupGoogleWorkspaceAvailabilityOptions) {
  const googleWorkspaceSetupLiteOnly = setupLiteMode !== false;
  const googleWorkspaceEnabledForUser =
    !googleWorkspaceSetupLiteOnly
    && (publicWorkspaceEnabled || coreAccessAllowed);
  const googleWorkspaceExtendedEnabledForUser =
    !googleWorkspaceSetupLiteOnly
    && (publicWorkspaceExtendedEnabled || extendedAccessAllowed);

  return {
    googleWorkspaceSetupLiteOnly,
    googleWorkspaceEnabledForUser,
    googleWorkspaceExtendedEnabledForUser,
  };
}

export function shouldDeferSetupCallbackProcessing({
  authProvider,
  gmailLiteConnectedFromSearch,
  driveLiteConnectedFromSearch,
  globalConnectBootstrap,
  gmailConnectedFromSearch,
  calendarConnectedFromSearch,
  driveConnectedFromSearch,
  activationFromSearch,
  setupError,
  authAccessTokenAvailable,
  isCheckingSession,
}: SetupCallbackProcessingOptions) {
  if (authAccessTokenAvailable || !isCheckingSession) {
    return false;
  }

  return (
    authProvider === "google"
    || gmailLiteConnectedFromSearch
    || driveLiteConnectedFromSearch
    || globalConnectBootstrap
    || gmailConnectedFromSearch
    || calendarConnectedFromSearch
    || driveConnectedFromSearch
    || activationFromSearch
    || Boolean(setupError)
  );
}
