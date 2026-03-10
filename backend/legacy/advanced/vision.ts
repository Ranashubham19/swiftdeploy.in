export const analyzeImageWithOpenRouter = async (
  imageUrl: string,
  userPrompt: string,
): Promise<string | null> => {
  const enabled = String(process.env.LEGACY_IMAGE_ANALYSIS_ENABLED || "false").trim().toLowerCase() === "true";
  if (!enabled) return null;
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) return null;
  const url = String(imageUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const model = String(process.env.OPENROUTER_VISION_MODEL || process.env.DEFAULT_MODEL || "openrouter/free").trim();
  const endpoint = String(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions").trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: String(userPrompt || "Analyze this image and answer the user's request.") },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as any;
    const text = String(data?.choices?.[0]?.message?.content || "").trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
