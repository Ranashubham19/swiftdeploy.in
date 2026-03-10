import type { OpenRouterContentPart, OpenRouterMessage } from "./openrouter/client.js";

export const buildVisionUserContent = (
  promptText: string,
  imageUrls: string[],
): OpenRouterContentPart[] => {
  const normalizedPrompt = String(promptText || "").trim() || "Analyze this image.";
  const uniqueUrls = Array.from(
    new Set(
      (imageUrls || [])
        .map((url) => String(url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url)),
    ),
  ).slice(0, 4);

  const parts: OpenRouterContentPart[] = [{ type: "text", text: normalizedPrompt }];
  for (const url of uniqueUrls) {
    parts.push({
      type: "image_url",
      image_url: { url },
    });
  }
  return parts;
};

export const injectLatestUserVisionMessage = (
  sourceMessages: OpenRouterMessage[],
  promptText: string,
  imageUrls: string[],
): OpenRouterMessage[] => {
  const content = buildVisionUserContent(promptText, imageUrls);
  if (content.length <= 1) return [...sourceMessages];

  const nextMessages = [...sourceMessages];
  for (let i = nextMessages.length - 1; i >= 0; i -= 1) {
    const candidate = nextMessages[i];
    if (!candidate || candidate.role !== "user") continue;
    nextMessages[i] = {
      ...candidate,
      content,
    };
    return nextMessages;
  }

  return [...nextMessages, { role: "user", content }];
};
