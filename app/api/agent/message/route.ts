import { NextRequest, NextResponse } from "next/server";

import {
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
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;

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
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (!body.userId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
      }

      if (body.consentToken) {
        const verified = verifyAppAccessConsentToken(body.consentToken, body.userId);
        if (!verified) {
          return NextResponse.json(
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
              },
            },
          });
          return NextResponse.json({
            success: true,
            response: deniedResponse,
            consentResolved: {
              token: body.consentToken,
              status: "denied" as const,
            },
          });
        }

        await clearLatestAppAccessConsent(verified.userId, body.consentToken).catch(() => undefined);
        const result = await routeInboundAgentMessageResult(verified.userId, verified.originalMessage, {
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

        return NextResponse.json({
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
        return NextResponse.json({ error: "message is required" }, { status: 400 });
      }

      const result = await routeInboundAgentMessageResult(body.userId, body.message);
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
      return NextResponse.json({
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
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (body.consentToken) {
      const verified = verifyAppAccessConsentToken(body.consentToken, auth.user.id);
      if (!verified) {
        return NextResponse.json(
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
            },
          },
        });
        return NextResponse.json({
          success: true,
          response: deniedResponse,
          consentResolved: {
            token: body.consentToken,
            status: "denied" as const,
          },
        });
      }

      await clearLatestAppAccessConsent(auth.user.id, body.consentToken).catch(() => undefined);
      const result = await routeInboundAgentMessageResult(auth.user.id, verified.originalMessage, {
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

      return NextResponse.json({
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
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const userId = body.userId ?? auth.user.id;
    if (userId !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await routeInboundAgentMessageResult(userId, body.message);
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
    return NextResponse.json({
      success: true,
      response: result.response,
      liveAnswerBundle: result.liveAnswerBundle ?? null,
      modelAuditTrail: result.modelAuditTrail ?? null,
      consentRequest: result.consentRequest ?? null,
      styleRequest: result.styleRequest ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
