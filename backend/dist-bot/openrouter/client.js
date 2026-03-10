import { logger } from "../utils/logger.js";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const sleep = async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
};
const normalizeEndpoint = (baseUrl) => {
    const raw = baseUrl.trim();
    const withProtocol = /^https?:\/\//i.test(raw)
        ? raw
        : `${DEFAULT_OPENROUTER_BASE}`;
    const trimmed = withProtocol.replace(/\/+$/, "");
    const candidate = trimmed.endsWith("/chat/completions")
        ? trimmed
        : `${trimmed}/chat/completions`;
    try {
        return new URL(candidate).toString();
    }
    catch {
        return `${DEFAULT_OPENROUTER_BASE}/chat/completions`;
    }
};
const parseUsage = (usage) => {
    if (!usage)
        return undefined;
    return {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
    };
};
const extractDeltaText = (content) => {
    if (!content)
        return "";
    if (typeof content === "string")
        return content;
    return content
        .map((part) => {
        if (typeof part?.text === "string")
            return part.text;
        return "";
    })
        .join("");
};
export class OpenRouterClient {
    config;
    endpoint;
    timeoutMs;
    maxRetries;
    retryBaseDelayMs;
    constructor(config) {
        this.config = config;
        this.endpoint = normalizeEndpoint(config.baseUrl);
        this.timeoutMs = config.timeoutMs ?? 45_000;
        this.maxRetries = config.maxRetries ?? 4;
        this.retryBaseDelayMs = config.retryBaseDelayMs ?? 180;
    }
    async chatCompletion(params, options) {
        const payload = {
            ...params,
            stream: false,
        };
        const body = await this.requestJson(payload, options);
        const choice = body.choices?.[0];
        const message = choice?.message;
        return {
            id: body.id,
            model: body.model,
            content: message?.content ?? "",
            finishReason: choice?.finish_reason ?? null,
            toolCalls: message?.tool_calls ?? [],
            usage: parseUsage(body.usage),
        };
    }
    async streamChatCompletion(params, options = {}) {
        const payload = {
            ...params,
            stream: true,
        };
        const result = await this.requestStream(payload, options);
        return result;
    }
    async requestJson(payload, options) {
        return this.withRetry(async () => {
            const response = await this.fetchWithTimeout(payload, options?.signal);
            const raw = await response.text();
            const body = raw ? JSON.parse(raw) : {};
            if (!response.ok) {
                const message = body.error?.message ??
                    `OpenRouter request failed with status ${response.status}`;
                const error = new Error(message);
                error.status = response.status;
                throw error;
            }
            return body;
        }, options?.signal);
    }
    async requestStream(payload, options) {
        return this.withRetry(async () => {
            const response = await this.fetchWithTimeout(payload, options.signal);
            if (!response.ok) {
                const raw = await response.text();
                let message = `OpenRouter stream failed with status ${response.status}`;
                try {
                    const parsed = raw ? JSON.parse(raw) : {};
                    if (parsed.error?.message)
                        message = parsed.error.message;
                }
                catch { }
                const error = new Error(message);
                error.status = response.status;
                throw error;
            }
            const contentType = (response.headers.get("content-type") || "").toLowerCase();
            // Some providers ignore `stream: true` and return a normal JSON payload.
            if (contentType.includes("application/json")) {
                const raw = await response.text();
                const parsed = raw ? JSON.parse(raw) : null;
                const choice = parsed?.choices?.[0];
                const message = choice?.message;
                return {
                    text: message?.content ?? "",
                    finishReason: choice?.finish_reason ?? null,
                    toolCalls: message?.tool_calls ?? [],
                    usage: parseUsage(parsed?.usage),
                };
            }
            if (!response.body) {
                throw new Error("OpenRouter stream returned empty body.");
            }
            const decoder = new TextDecoder();
            const reader = response.body.getReader();
            let buffer = "";
            let text = "";
            // Some providers return cumulative final text in `message.content` instead of `delta.content`.
            let messageSnapshot = "";
            let finishReason = null;
            let usage;
            const toolCallsByIndex = new Map();
            const emitDelta = (delta) => {
                if (!options.onDelta || !delta)
                    return;
                try {
                    const maybePromise = options.onDelta(delta);
                    if (maybePromise && typeof maybePromise.then === "function") {
                        void maybePromise.catch(() => { });
                    }
                }
                catch { }
            };
            const processEventChunk = (chunk) => {
                const lines = chunk
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => line.slice(5).trim());
                for (const line of lines) {
                    if (!line || line === "[DONE]")
                        continue;
                    let payloadChunk;
                    try {
                        payloadChunk = JSON.parse(line);
                    }
                    catch {
                        continue;
                    }
                    const choice = payloadChunk.choices?.[0];
                    if (!choice)
                        continue;
                    if (choice.finish_reason) {
                        finishReason = choice.finish_reason;
                    }
                    if (payloadChunk.usage) {
                        usage = parseUsage(payloadChunk.usage);
                    }
                    const deltaText = extractDeltaText(choice.delta?.content);
                    if (deltaText) {
                        text += deltaText;
                        emitDelta(deltaText);
                    }
                    else if (typeof choice.message?.content === "string") {
                        const messageText = choice.message.content;
                        if (messageText.length > messageSnapshot.length) {
                            const incrementalText = messageText.startsWith(messageSnapshot)
                                ? messageText.slice(messageSnapshot.length)
                                : messageText;
                            messageSnapshot = messageText;
                            if (incrementalText) {
                                text += incrementalText;
                                emitDelta(incrementalText);
                            }
                        }
                    }
                    for (const toolDelta of choice.delta?.tool_calls ?? []) {
                        const index = toolDelta.index ?? 0;
                        const existing = toolCallsByIndex.get(index) ?? {
                            id: "",
                            type: "function",
                            function: {
                                name: "",
                                arguments: "",
                            },
                        };
                        if (toolDelta.id)
                            existing.id = toolDelta.id;
                        if (toolDelta.function?.name) {
                            existing.function.name += toolDelta.function.name;
                        }
                        if (toolDelta.function?.arguments) {
                            existing.function.arguments += toolDelta.function.arguments;
                        }
                        toolCallsByIndex.set(index, existing);
                    }
                }
            };
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const chunks = buffer.split(/\r?\n\r?\n/);
                buffer = chunks.pop() ?? "";
                for (const chunk of chunks) {
                    processEventChunk(chunk);
                }
            }
            // Flush decoder remainder + final SSE event if stream ended without trailing delimiter.
            buffer += decoder.decode();
            if (buffer.trim()) {
                const trailingChunks = buffer.split(/\r?\n\r?\n/);
                for (const trailingChunk of trailingChunks) {
                    processEventChunk(trailingChunk);
                }
            }
            const toolCalls = Array.from(toolCallsByIndex.entries())
                .sort((a, b) => a[0] - b[0])
                .map((entry) => entry[1]);
            return {
                text,
                finishReason,
                toolCalls,
                usage,
            };
        }, options.signal);
    }
    async withRetry(operation, signal) {
        let lastError;
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            if (signal?.aborted) {
                const abortError = new Error("OpenRouter request aborted.");
                abortError.name = "AbortError";
                throw abortError;
            }
            try {
                return await operation(attempt);
            }
            catch (error) {
                lastError = error;
                const status = error?.status;
                const retryable = typeof status === "number" && RETRYABLE_STATUSES.has(status);
                if (!retryable || attempt >= this.maxRetries) {
                    throw error;
                }
                const delay = Math.min(2400, this.retryBaseDelayMs * 2 ** attempt) + Math.random() * 90;
                logger.warn({ attempt, status, delay, error: String(error?.message ?? error) }, "OpenRouter request failed, retrying");
                await sleep(delay);
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    async fetchWithTimeout(payload, parentSignal) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const onParentAbort = () => {
            controller.abort();
        };
        if (parentSignal) {
            parentSignal.addEventListener("abort", onParentAbort, { once: true });
        }
        try {
            return await fetch(this.endpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.config.apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": this.config.appUrl || "https://localhost",
                    "X-Title": this.config.title || "Telegram Chat Bot",
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timeout);
            if (parentSignal) {
                parentSignal.removeEventListener("abort", onParentAbort);
            }
        }
    }
}
