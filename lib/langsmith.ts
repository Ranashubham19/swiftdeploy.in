import { env } from "@/lib/env";

type TraceHandle = {
  id: string;
  end: (payload?: Record<string, unknown>) => Promise<void>;
  fail: (error: unknown, payload?: Record<string, unknown>) => Promise<void>;
};

async function langsmithFetch(path: string, init?: RequestInit) {
  return fetch(`https://api.smith.langchain.com${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "x-api-key": env.LANGSMITH_API_KEY,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function startTrace(name: string, inputs: Record<string, unknown>) {
  if (!env.LANGSMITH_API_KEY) {
    return null;
  }

  const id = crypto.randomUUID();
  const startTime = new Date().toISOString();

  try {
    await langsmithFetch("/runs", {
      method: "POST",
      body: JSON.stringify({
        id,
        name,
        run_type: "chain",
        session_name: env.LANGSMITH_PROJECT,
        start_time: startTime,
        inputs,
      }),
    });
  } catch {
    return null;
  }

  const finish = async (statusPayload: Record<string, unknown>) => {
    try {
      await langsmithFetch(`/runs/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          end_time: new Date().toISOString(),
          ...statusPayload,
        }),
      });
    } catch {
      // Observability is best-effort.
    }
  };

  return {
    id,
    end: (payload = {}) =>
      finish({
        outputs: payload,
      }),
    fail: (error, payload = {}) =>
      finish({
        error: error instanceof Error ? error.message : String(error),
        outputs: payload,
      }),
  } satisfies TraceHandle;
}
