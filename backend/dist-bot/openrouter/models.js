const fromEnv = (name, fallback) => (process.env[name] || "").trim() || fallback;
export const LOCKED_NVIDIA_MODEL_ID = fromEnv("NVIDIA_MODEL", fromEnv("DEFAULT_MODEL", fromEnv("OPENROUTER_MODEL", "meta/llama-3.3-70b-instruct")));
export const OPENROUTER_FREE_MODEL_ID = LOCKED_NVIDIA_MODEL_ID;
// Hard-lock runtime model selection so only the configured NVIDIA model is used.
export const FORCE_OPENROUTER_FREE_ONLY_MODE = true;
export const ZERO_COST_OPENROUTER_MODEL_IDS = [
    LOCKED_NVIDIA_MODEL_ID,
];
const zeroCostOpenRouterModelIdSet = new Set(ZERO_COST_OPENROUTER_MODEL_IDS.map((id) => id.toLowerCase()));
export const isFreeOnlyApprovedModelId = (modelId) => {
    const normalized = String(modelId || "").trim().toLowerCase();
    if (!normalized)
        return false;
    return normalized === OPENROUTER_FREE_MODEL_ID
        || normalized.endsWith(":free")
        || zeroCostOpenRouterModelIdSet.has(normalized);
};
const curatedFreeModelPoolByRole = {
    fast: [LOCKED_NVIDIA_MODEL_ID],
    general: [LOCKED_NVIDIA_MODEL_ID],
    smart: [LOCKED_NVIDIA_MODEL_ID],
    code: [LOCKED_NVIDIA_MODEL_ID],
    math: [LOCKED_NVIDIA_MODEL_ID],
    current_events: [LOCKED_NVIDIA_MODEL_ID],
    vision: [LOCKED_NVIDIA_MODEL_ID],
};
export const CURATED_FREE_MODEL_POOLS = Object.fromEntries(Object.entries(curatedFreeModelPoolByRole).map(([role, ids]) => {
    const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    return [role, unique];
}));
const curatedStrongFreeModelIdSet = new Set(Object.values(CURATED_FREE_MODEL_POOLS)
    .flat()
    .map((id) => String(id || "").trim().toLowerCase())
    .filter(Boolean));
export const isCuratedStrongFreeModelId = (modelId) => {
    const normalized = String(modelId || "").trim().toLowerCase();
    if (!normalized)
        return false;
    return curatedStrongFreeModelIdSet.has(normalized);
};
export const getCuratedFreeModelPool = (role, preferredModelId) => {
    const preferred = String(preferredModelId || "").trim();
    const ordered = [
        preferred && isCuratedStrongFreeModelId(preferred) ? preferred : "",
        ...CURATED_FREE_MODEL_POOLS[role],
    ].filter(Boolean);
    return Array.from(new Set(ordered));
};
const modelIdWithFreeOnly = (_envName, _fallback, _options) => {
    return LOCKED_NVIDIA_MODEL_ID;
};
export const MODEL_REGISTRY = {
    auto: {
        key: "auto",
        label: "Auto",
        id: modelIdWithFreeOnly("DEFAULT_MODEL", CURATED_FREE_MODEL_POOLS.general[0]),
        description: "Intent-based automatic routing.",
        temperature: 0.3,
        maxTokens: 2200,
    },
    fast: {
        key: "fast",
        label: "Fast",
        id: modelIdWithFreeOnly("MODEL_FAST_ID", CURATED_FREE_MODEL_POOLS.fast[0]),
        description: "Low-latency general assistant.",
        temperature: 0.25,
        maxTokens: 1800,
    },
    smart: {
        key: "smart",
        label: "Smart",
        id: modelIdWithFreeOnly("MODEL_SMART_ID", CURATED_FREE_MODEL_POOLS.smart[0]),
        description: "High quality general reasoning.",
        temperature: 0.2,
        maxTokens: 2600,
    },
    code: {
        key: "code",
        label: "Code",
        id: modelIdWithFreeOnly("MODEL_CODE_ID", CURATED_FREE_MODEL_POOLS.code[0]),
        description: "Coding, debugging, and architecture.",
        temperature: 0.12,
        maxTokens: 2800,
    },
    math: {
        key: "math",
        label: "Math",
        id: modelIdWithFreeOnly("MODEL_MATH_ID", CURATED_FREE_MODEL_POOLS.math[0]),
        description: "Mathematics and step-by-step reasoning.",
        temperature: 0.1,
        maxTokens: 2800,
    },
    vision: {
        key: "vision",
        label: "Vision",
        id: modelIdWithFreeOnly("MODEL_VISION_ID", CURATED_FREE_MODEL_POOLS.vision[0]),
        description: "Image-capable model where supported.",
        temperature: 0.35,
        maxTokens: 1400,
    },
};
export const MODEL_LIST = [
    MODEL_REGISTRY.auto,
];
export const FALLBACK_MODEL_ID = modelIdWithFreeOnly("FALLBACK_MODEL", LOCKED_NVIDIA_MODEL_ID);
export const resolveModelFromKey = (key) => {
    if (!key)
        return null;
    const normalized = key.trim().toLowerCase();
    if (normalized in MODEL_REGISTRY) {
        return MODEL_REGISTRY[normalized];
    }
    return null;
};
