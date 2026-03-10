const truthy = (value) => /^(1|true|yes|on)$/i.test(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sleep = async (ms) => await new Promise((resolve) => setTimeout(resolve, ms));
const normalizeSttEndpoint = (raw) => {
    const trimmed = String(raw || "").trim().replace(/\/+$/, "");
    if (!trimmed)
        return "";
    if (/\/audio\/transcriptions$/i.test(trimmed))
        return trimmed;
    let normalized = trimmed.replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
    if (/\/v1$/i.test(normalized)) {
        return `${normalized}/audio/transcriptions`;
    }
    if (/\/v1\//i.test(normalized)) {
        normalized = normalized.replace(/\/v1\/.*$/i, "/v1");
        return `${normalized}/audio/transcriptions`;
    }
    return `${normalized}/v1/audio/transcriptions`;
};
const normalizeAssemblyAiBaseUrl = (raw) => {
    const fallback = "https://api.assemblyai.com/v2";
    const trimmed = String(raw || "").trim().replace(/\/+$/, "");
    if (!trimmed)
        return fallback;
    let normalized = trimmed.replace(/\/transcript$/i, "").replace(/\/+$/, "");
    if (/\/v2$/i.test(normalized))
        return normalized;
    if (/\/v2\//i.test(normalized)) {
        return normalized.replace(/\/v2\/.*$/i, "/v2");
    }
    return `${normalized}/v2`;
};
const readTextFromTranscriptionPayload = (payload) => {
    const candidates = [
        payload?.text,
        payload?.transcript,
        payload?.result?.text,
        payload?.data?.text,
        payload?.data?.transcript,
    ];
    for (const candidate of candidates) {
        const value = String(candidate || "").trim();
        if (value)
            return value;
    }
    return "";
};
const buildSttProviders = () => {
    const providers = [];
    const assemblyKey = String(process.env.ASSEMBLYAI_API_KEY || process.env.STT_ASSEMBLYAI_API_KEY || "").trim();
    const assemblyEnabledRaw = String(process.env.ASSEMBLYAI_STT_ENABLED || process.env.STT_USE_ASSEMBLYAI || "").trim();
    const assemblyEnabled = assemblyEnabledRaw ? truthy(assemblyEnabledRaw) : !!assemblyKey;
    if (assemblyEnabled && assemblyKey) {
        const assemblyBaseUrl = normalizeAssemblyAiBaseUrl(String(process.env.ASSEMBLYAI_BASE_URL || "https://api.assemblyai.com/v2").trim());
        const assemblySpeechModel = String(process.env.ASSEMBLYAI_SPEECH_MODEL || process.env.ASSEMBLYAI_MODEL || "universal-2").trim();
        const assemblyPollIntervalMs = clamp(Number(process.env.ASSEMBLYAI_POLL_INTERVAL_MS || 1800), 500, 5000);
        providers.push({
            kind: "assemblyai",
            baseUrl: assemblyBaseUrl,
            apiKey: assemblyKey,
            speechModel: assemblySpeechModel || "universal-2",
            pollIntervalMs: assemblyPollIntervalMs,
        });
    }
    const sttBase = normalizeSttEndpoint(String(process.env.STT_BASE_URL || process.env.STT_ENDPOINT || "").trim());
    const sttKey = String(process.env.STT_API_KEY || "").trim();
    const sttModel = String(process.env.STT_MODEL || "whisper-1").trim();
    if (sttBase && sttKey) {
        providers.push({
            kind: "openai_compatible",
            endpoint: sttBase,
            apiKey: sttKey,
            model: sttModel || "whisper-1",
        });
    }
    const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (openaiKey) {
        providers.push({
            kind: "openai_compatible",
            endpoint: "https://api.openai.com/v1/audio/transcriptions",
            apiKey: openaiKey,
            model: sttModel || "whisper-1",
        });
    }
    const nvidiaToggleRaw = String(process.env.NVIDIA_STT_ENABLED || process.env.STT_USE_NVIDIA || "").trim();
    const nvidiaEnabled = nvidiaToggleRaw ? truthy(nvidiaToggleRaw) : true;
    const nvidiaKey = String(process.env.NVIDIA_API_KEY || process.env.OPENROUTER_API_KEY || "").trim();
    const nvidiaBase = normalizeSttEndpoint(String(process.env.NVIDIA_STT_BASE_URL
        || process.env.NVIDIA_BASE_URL
        || process.env.OPENROUTER_BASE_URL
        || "").trim());
    const nvidiaModel = String(process.env.NVIDIA_STT_MODEL || process.env.STT_NVIDIA_MODEL || "whisper-1").trim();
    if (nvidiaEnabled && nvidiaKey && nvidiaBase) {
        providers.push({
            kind: "openai_compatible",
            endpoint: nvidiaBase,
            apiKey: nvidiaKey,
            model: nvidiaModel,
        });
    }
    const seen = new Set();
    const deduped = [];
    for (const provider of providers) {
        const key = provider.kind === "assemblyai"
            ? `${provider.kind}|${provider.baseUrl}|${provider.speechModel}|${provider.apiKey.slice(0, 8)}`
            : `${provider.kind}|${provider.endpoint}|${provider.model}|${provider.apiKey.slice(0, 8)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push(provider);
    }
    return deduped;
};
const transcribeWithOpenAICompatibleProvider = async (mediaBlob, provider, opts) => {
    const form = new FormData();
    form.append("model", provider.model);
    if (opts?.language)
        form.append("language", opts.language);
    if (opts?.prompt)
        form.append("prompt", opts.prompt);
    form.append("response_format", "json");
    form.append("file", mediaBlob, "telegram-media-input");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3000, opts?.timeoutMs ?? 15000));
    try {
        const response = await fetch(provider.endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${provider.apiKey}`,
            },
            body: form,
            signal: controller.signal,
        });
        if (!response.ok)
            return null;
        const payload = (await response.json().catch(() => ({})));
        const text = readTextFromTranscriptionPayload(payload);
        return text || null;
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timeout);
    }
};
const transcribeWithAssemblyAiProvider = async (mediaInput, provider, opts) => {
    const totalTimeoutMs = Math.max(12000, opts?.timeoutMs ?? Number(process.env.ASSEMBLYAI_STT_TIMEOUT_MS || 45000));
    const deadline = Date.now() + totalTimeoutMs;
    const uploadToAssemblyAi = async (mediaBlob) => {
        const uploadController = new AbortController();
        const uploadTimeout = setTimeout(() => uploadController.abort(), Math.max(3000, Math.min(totalTimeoutMs, 20000)));
        try {
            const uploadResponse = await fetch(`${provider.baseUrl}/upload`, {
                method: "POST",
                headers: {
                    authorization: provider.apiKey,
                    "content-type": "application/octet-stream",
                },
                body: mediaBlob,
                signal: uploadController.signal,
            });
            if (!uploadResponse.ok)
                return null;
            const uploadPayload = (await uploadResponse.json().catch(() => ({})));
            const uploadUrl = String(uploadPayload?.upload_url || "").trim();
            return uploadUrl || null;
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(uploadTimeout);
        }
    };
    let transcriptAudioUrl = String(mediaInput.fileUrl || "").trim();
    const uploadedUrl = mediaInput.mediaBlob
        ? await uploadToAssemblyAi(mediaInput.mediaBlob)
        : null;
    if (uploadedUrl) {
        transcriptAudioUrl = uploadedUrl;
    }
    if (!transcriptAudioUrl)
        return null;
    const submitPayload = {
        audio_url: transcriptAudioUrl,
        speech_models: [provider.speechModel || "universal-2"],
    };
    if (opts?.language) {
        submitPayload.language_detection = false;
        submitPayload.language_code = opts.language;
    }
    let transcriptId = "";
    let latestStatus = "";
    let latestPayload = null;
    const submitController = new AbortController();
    const submitTimeout = setTimeout(() => submitController.abort(), Math.max(3000, Math.min(totalTimeoutMs, 15000)));
    try {
        const submitResponse = await fetch(`${provider.baseUrl}/transcript`, {
            method: "POST",
            headers: {
                authorization: provider.apiKey,
                "content-type": "application/json",
            },
            body: JSON.stringify(submitPayload),
            signal: submitController.signal,
        });
        if (!submitResponse.ok)
            return null;
        latestPayload = (await submitResponse.json().catch(() => ({})));
        latestStatus = String(latestPayload?.status || "").toLowerCase();
        transcriptId = String(latestPayload?.id || "").trim();
        if (latestStatus === "completed") {
            const text = readTextFromTranscriptionPayload(latestPayload);
            return text || null;
        }
        if (latestStatus === "error" || !transcriptId)
            return null;
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(submitTimeout);
    }
    while (Date.now() < deadline) {
        await sleep(provider.pollIntervalMs);
        const pollController = new AbortController();
        const pollTimeout = setTimeout(() => pollController.abort(), Math.max(3000, provider.pollIntervalMs + 5000));
        try {
            const pollResponse = await fetch(`${provider.baseUrl}/transcript/${encodeURIComponent(transcriptId)}`, {
                method: "GET",
                headers: {
                    authorization: provider.apiKey,
                },
                signal: pollController.signal,
            });
            if (!pollResponse.ok) {
                if (pollResponse.status === 429 || pollResponse.status >= 500) {
                    continue;
                }
                return null;
            }
            latestPayload = (await pollResponse.json().catch(() => ({})));
            latestStatus = String(latestPayload?.status || "").toLowerCase();
            if (latestStatus === "completed") {
                const text = readTextFromTranscriptionPayload(latestPayload);
                return text || null;
            }
            if (latestStatus === "error") {
                return null;
            }
        }
        catch {
            continue;
        }
        finally {
            clearTimeout(pollTimeout);
        }
    }
    return null;
};
export const transcribeTelegramMediaFromUrl = async (fileUrl, opts) => {
    const url = String(fileUrl || "").trim();
    if (!/^https?:\/\//i.test(url))
        return null;
    const providers = buildSttProviders();
    if (providers.length === 0)
        return null;
    let cachedMediaBlob = null;
    let mediaBlobFetched = false;
    const getMediaBlob = async () => {
        if (mediaBlobFetched)
            return cachedMediaBlob;
        mediaBlobFetched = true;
        const mediaController = new AbortController();
        const mediaTimeout = setTimeout(() => mediaController.abort(), Math.max(3000, opts?.timeoutMs ?? 15000));
        try {
            const mediaRes = await fetch(url, { signal: mediaController.signal });
            if (!mediaRes.ok)
                return null;
            cachedMediaBlob = await mediaRes.blob();
            return cachedMediaBlob;
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(mediaTimeout);
        }
    };
    for (const provider of providers) {
        if (provider.kind === "assemblyai") {
            const mediaBlob = await getMediaBlob();
            const text = await transcribeWithAssemblyAiProvider({ fileUrl: url, mediaBlob }, provider, opts);
            if (text)
                return text;
            continue;
        }
        const mediaBlob = await getMediaBlob();
        if (!mediaBlob)
            continue;
        const text = await transcribeWithOpenAICompatibleProvider(mediaBlob, provider, opts);
        if (text)
            return text;
    }
    return null;
};
