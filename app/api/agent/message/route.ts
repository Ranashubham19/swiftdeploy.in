import { NextRequest, NextResponse } from "next/server";

import {
  buildInboundAgentTimeoutResultForRouteFallback,
  routeInboundAgentMessageResult,
} from "@/lib/clawcloud-agent";
import { recordClawCloudAnswerObservability } from "@/lib/clawcloud-answer-observability";
import { recordClawCloudChatRun } from "@/lib/clawcloud-usage";
import {
  buildAppAccessDeniedReply,
  buildAppAccessExpiredReply,
  clearLatestAppAccessConsent,
  verifyAppAccessConsentToken,
} from "@/lib/clawcloud-app-access-consent";
import {
  getClawCloudErrorMessage,
  isValidSharedSecret,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import { recordAnswerQualitySignals } from "@/lib/clawcloud-observability";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;

async function proxyAgentMessageToRailway(input: {
  userId: string;
  message: string;
  skipAppAccessConsent?: boolean;
  skipConversationStyleChoice?: boolean;
  conversationStyle?: import("@/lib/clawcloud-conversation-style").ClawCloudConversationStyle;
}) {
  const agentServerUrl =
    env.AGENT_SERVER_URL?.trim().replace(/\/+$/, "")
    || env.BACKEND_API_URL?.trim().replace(/\/+$/, "")
    || "";
  const agentSecret = env.AGENT_SECRET?.trim() || "";
  if (!agentServerUrl || !agentSecret) {
    return { kind: "not_configured" as const };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 85_000);
  try {
    const response = await fetch(`${agentServerUrl}/agent/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${agentSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null) as null | {
      success?: boolean;
      response?: string | null;
      liveAnswerBundle?: import("@/lib/types").ClawCloudAnswerBundle | null;
      modelAuditTrail?: import("@/lib/types").ClawCloudModelAuditTrail | null;
      consentRequest?: import("@/lib/clawcloud-app-access-consent").AppAccessConsentRequest | null;
      styleRequest?: import("@/lib/clawcloud-conversation-style").ClawCloudConversationStyleRequest | null;
    };

    if (!response.ok || !payload?.success) {
      return { kind: "failed" as const };
    }

    return {
      kind: "success" as const,
      result: {
        response: payload.response ?? null,
        liveAnswerBundle: payload.liveAnswerBundle ?? null,
        modelAuditTrail: payload.modelAuditTrail ?? null,
        consentRequest: payload.consentRequest ?? null,
        styleRequest: payload.styleRequest ?? null,
      },
    };
  } catch {
    return { kind: "failed" as const };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAgentMessageResult(input: {
  userId: string;
  message: string;
  skipAppAccessConsent?: boolean;
  skipConversationStyleChoice?: boolean;
  conversationStyle?: import("@/lib/clawcloud-conversation-style").ClawCloudConversationStyle;
}) {
  const proxied = await proxyAgentMessageToRailway(input);
  if (proxied.kind === "success") {
    return proxied.result;
  }

  if (proxied.kind === "not_configured") {
    return routeInboundAgentMessageResult(input.userId, input.message, {
      skipAppAccessConsent: input.skipAppAccessConsent,
      skipConversationStyleChoice: input.skipConversationStyleChoice,
      conversationStyle: input.conversationStyle,
    });
  }

  return buildInboundAgentTimeoutResultForRouteFallback(input.message);
}

async function recordAgentMessageObservability(input: {
  userId: string;
  message: string;
  result: {
    response?: string | null;
    consentRequest?: unknown;
    styleRequest?: unknown;
    observability?: import("@/lib/clawcloud-answer-observability").ClawCloudAnswerObservabilitySnapshot | null;
  };
  inputKind: string;
  metadata?: Record<string, unknown> | null;
}) {
  if (input.result.observability?.qualityFlags?.length) {
    recordAnswerQualitySignals(input.result.observability.qualityFlags);
  }
  await recordClawCloudAnswerObservability({
    userId: input.userId,
    question: input.message,
    response: input.result.response ?? null,
    inputKind: input.inputKind,
    consentPrompt: Boolean(input.result.consentRequest || input.result.styleRequest),
    metadata: input.metadata ?? {},
    snapshot: input.result.observability ?? null,
  }).catch(() => undefined);
}

function recordAgentMessageObservabilityLater(input: Parameters<typeof recordAgentMessageObservability>[0]) {
  void recordAgentMessageObservability(input);
}

function recordAgentChatRunLater(input: Parameters<typeof recordClawCloudChatRun>[0]) {
  void recordClawCloudChatRun(input).catch(() => undefined);
}

function jsonUtf8(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Content-Type", "application/json; charset=utf-8");
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      message?: string;
      _internal?: boolean;
      consentToken?: string;
      consentDecision?: "approve" | "deny";
    };

    if (body._internal) {
      if (!isValidSharedSecret(request, env.CRON_SECRET, env.AGENT_SECRET)) {
        return jsonUtf8({ error: "Unauthorized" }, { status: 401 });
      }

      if (!body.userId) {
        return jsonUtf8({ error: "userId is required" }, { status: 400 });
      }

      if (body.consentToken) {
        const verified = verifyAppAccessConsentToken(body.consentToken, body.userId);
        if (!verified) {
          return jsonUtf8(
            {
              success: false,
              error: buildAppAccessExpiredReply(),
            },
            { status: 400 },
          );
        }

        if (body.consentDecision === "deny") {
          await clearLatestAppAccessConsent(verified.userId, body.consentToken).catch(() => undefined);
          const deniedResponse = buildAppAccessDeniedReply(verified.surface, verified.operation);
          recordAgentMessageObservabilityLater({
            userId: verified.userId,
            message: verified.originalMessage,
            inputKind: "consent_resolution",
            metadata: {
              consent_status: "denied",
              surface: verified.surface,
              operation: verified.operation,
            },
            result: {
              response: deniedResponse,
              observability: {
                intent: "app_access",
                category: "consent",
                latencyMs: 0,
                charCount: deniedResponse.length,
                hadVisibleFallback: false,
                liveAnswer: false,
                liveEvidenceCount: 0,
                liveSourceCount: 0,
                liveStrategy: null,
                modelAudited: false,
                selectedBy: null,
                selectedModel: null,
                judgeUsed: false,
                materialDisagreement: false,
                needsClarification: false,
                qualityFlags: [],
              },
            },
          });
          return jsonUtf8({
            success: true,
            response: deniedResponse,
            consentResolved: {
              token: body.consentToken,
              status: "denied" as const,
            },
          });
        }

        await clearLatestAppAccessConsent(verified.userId, body.consentToken).catch(() => undefined);
        const result = await resolveAgentMessageResult({
          userId: verified.userId,
          message: verified.originalMessage,
          skipAppAccessConsent: true,
        });
        recordAgentMessageObservabilityLater({
          userId: verified.userId,
          message: verified.originalMessage,
          inputKind: "consent_resolution",
          metadata: {
            consent_status: "approved",
            surface: verified.surface,
            operation: verified.operation,
          },
          result,
        });

        return jsonUtf8({
          success: true,
          response: result.response,
          liveAnswerBundle: result.liveAnswerBundle ?? null,
          modelAuditTrail: result.modelAuditTrail ?? null,
          consentResolved: {
            token: body.consentToken,
            status: "approved" as const,
          },
        });
      }

      if (!body.message?.trim()) {
        return jsonUtf8({ error: "message is required" }, { status: 400 });
      }

      const result = await resolveAgentMessageResult({
        userId: body.userId,
        message: body.message,
      });
      recordAgentMessageObservabilityLater({
        userId: body.userId,
        message: body.message,
        inputKind: "api_inbound_message",
        metadata: {
          internal: true,
          consent_required: Boolean(result.consentRequest),
          style_required: Boolean(result.styleRequest),
        },
        result,
      });
      recordAgentChatRunLater({
        userId: body.userId,
        status: result.response?.trim() ? "success" : "failed",
        inputData: {
          message: body.message.trim().slice(0, 500),
          kind: result.consentRequest ? "consent_prompt" : result.styleRequest ? "style_prompt" : "api_inbound_message",
        },
        outputData: {
          char_count: result.response?.length ?? 0,
        },
      });
      return jsonUtf8({
        success: true,
        response: result.response,
        liveAnswerBundle: result.liveAnswerBundle ?? null,
        modelAuditTrail: result.modelAuditTrail ?? null,
        consentRequest: result.consentRequest ?? null,
        styleRequest: result.styleRequest ?? null,
      });
    }

    const auth = await requireClawCloudAuth(request);
    if (!auth.ok) {
      return jsonUtf8({ error: auth.error }, { status: auth.status });
    }

    if (body.consentToken) {
      const verified = verifyAppAccessConsentToken(body.consentToken, auth.user.id);
      if (!verified) {
        return jsonUtf8(
          {
            error: buildAppAccessExpiredReply(),
          },
          { status: 400 },
        );
      }

      if (body.consentDecision === "deny") {
        await clearLatestAppAccessConsent(auth.user.id, body.consentToken).catch(() => undefined);
        const deniedResponse = buildAppAccessDeniedReply(verified.surface, verified.operation);
        recordAgentMessageObservabilityLater({
          userId: auth.user.id,
          message: verified.originalMessage,
          inputKind: "consent_resolution",
          metadata: {
            consent_status: "denied",
            surface: verified.surface,
            operation: verified.operation,
          },
          result: {
            response: deniedResponse,
            observability: {
              intent: "app_access",
              category: "consent",
              latencyMs: 0,
              charCount: deniedResponse.length,
              hadVisibleFallback: false,
              liveAnswer: false,
              liveEvidenceCount: 0,
              liveSourceCount: 0,
              liveStrategy: null,
              modelAudited: false,
              selectedBy: null,
              selectedModel: null,
              judgeUsed: false,
              materialDisagreement: false,
              needsClarification: false,
              qualityFlags: [],
            },
          },
        });
        return jsonUtf8({
          success: true,
          response: deniedResponse,
          consentResolved: {
            token: body.consentToken,
            status: "denied" as const,
          },
        });
      }

      await clearLatestAppAccessConsent(auth.user.id, body.consentToken).catch(() => undefined);
      const result = await resolveAgentMessageResult({
        userId: auth.user.id,
        message: verified.originalMessage,
        skipAppAccessConsent: true,
      });
      recordAgentMessageObservabilityLater({
        userId: auth.user.id,
        message: verified.originalMessage,
        inputKind: "consent_resolution",
        metadata: {
          consent_status: "approved",
          surface: verified.surface,
          operation: verified.operation,
        },
        result,
      });

      return jsonUtf8({
        success: true,
        response: result.response,
        liveAnswerBundle: result.liveAnswerBundle ?? null,
        modelAuditTrail: result.modelAuditTrail ?? null,
        consentResolved: {
          token: body.consentToken,
          status: "approved" as const,
        },
      });
    }

    if (!body.message?.trim()) {
      return jsonUtf8({ error: "message is required" }, { status: 400 });
    }

    const userId = body.userId ?? auth.user.id;
    if (userId !== auth.user.id) {
      return jsonUtf8({ error: "Forbidden" }, { status: 403 });
    }

    const result = await resolveAgentMessageResult({
      userId,
      message: body.message,
    });
    recordAgentMessageObservabilityLater({
      userId,
      message: body.message,
      inputKind: "api_inbound_message",
      metadata: {
        internal: false,
        consent_required: Boolean(result.consentRequest),
        style_required: Boolean(result.styleRequest),
      },
      result,
    });
    recordAgentChatRunLater({
      userId,
      status: result.response?.trim() ? "success" : "failed",
      inputData: {
        message: body.message.trim().slice(0, 500),
        kind: result.consentRequest ? "consent_prompt" : result.styleRequest ? "style_prompt" : "api_inbound_message",
      },
      outputData: {
        char_count: result.response?.length ?? 0,
      },
    });
    return jsonUtf8({
      success: true,
      response: result.response,
      liveAnswerBundle: result.liveAnswerBundle ?? null,
      modelAuditTrail: result.modelAuditTrail ?? null,
      consentRequest: result.consentRequest ?? null,
      styleRequest: result.styleRequest ?? null,
    });
  } catch (error) {
    return jsonUtf8(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
