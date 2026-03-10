export const extractTextFromImageUrl = async (
  imageUrl: string,
  timeoutMs = 12000,
): Promise<string | null> => {
  const apiKey = String(process.env.OCR_SPACE_API_KEY || "").trim();
  if (!apiKey) return null;
  const url = String(imageUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, timeoutMs));
  try {
    const body = new URLSearchParams({
      url,
      language: "eng",
      isOverlayRequired: "false",
      detectOrientation: "true",
      scale: "true",
      OCREngine: "2",
    });
    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as any;
    const parsed = Array.isArray(data?.ParsedResults) ? data.ParsedResults : [];
    const text = parsed
      .map((x: any) => String(x?.ParsedText || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
