export const CLAWCLOUD_WHATSAPP_WAITING_QR_RECONNECT_MAX_ATTEMPTS = 3;

export function shouldAutoRestoreClawCloudWhatsAppSession(
  checkpoint: { requiresReauth?: boolean | null } | null | undefined,
) {
  return !checkpoint?.requiresReauth;
}

export function shouldRequireManualWhatsAppQrReconnect(input: {
  status: string;
  phone: string | null;
  disconnectCode: number | null | undefined;
  reconnectAttempts: number;
}) {
  const nextReconnectAttempt = Math.max(1, Math.trunc(input.reconnectAttempts) + 1);
  return input.status === "waiting"
    && !input.phone
    && input.disconnectCode === 408
    && nextReconnectAttempt >= CLAWCLOUD_WHATSAPP_WAITING_QR_RECONNECT_MAX_ATTEMPTS;
}
