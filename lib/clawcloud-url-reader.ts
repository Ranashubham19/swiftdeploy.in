import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_CONTENT_CHARS = 8_000;

const URL_PATTERN = /https?:\/\/[^\s]+/gi;
const YOUTUBE_PATTERN = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

export function extractUrlsFromMessage(message: string): string[] {
  return (message.match(URL_PATTERN) ?? []).map((url) => url.replace(/[).,;!?]+$/, ""));
}

export function extractYouTubeId(url: string): string | null {
  const match = url.match(YOUTUBE_PATTERN);
  return match?.[1] ?? null;
}

export function hasUrlIntent(message: string): boolean {
  const urls = extractUrlsFromMessage(message);
  if (!urls.length) {
    return false;
  }

  const hasSummariseIntent = /\b(summarise|summarize|summary|explain|read|tell me about|what is this|what does this say|translate this)\b/i.test(message);
  const isJustAUrl = message.trim().replace(URL_PATTERN, "").trim().length < 20;

  return hasSummariseIntent || isJustAUrl;
}

async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    if (!transcript?.length) {
      return null;
    }

    return transcript
      .map((item) => item.text)
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, MAX_CONTENT_CHARS);
  } catch {
    try {
      const { YoutubeTranscript } = await import("youtube-transcript");
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: "hi" });
      if (!transcript?.length) {
        return null;
      }

      const text = transcript.map((item) => item.text).join(" ").replace(/\s{2,}/g, " ").trim();
      return `[Hindi transcript]\n${text.slice(0, MAX_CONTENT_CHARS)}`;
    } catch {
      return null;
    }
  }
}

async function fetchArticleText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClawCloud/1.0; +https://swift-deploy.in)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const { load } = await import("cheerio");
    const $ = load(html);

    $("script, style, nav, footer, header, aside, .ad, .advertisement, .cookie, .popup, .modal, .sidebar, [class*='nav'], [class*='menu'], [class*='header'], [class*='footer']").remove();

    const title = $("title").text().trim() || $("h1").first().text().trim();
    const articleSelectors = ["article", "main", ".article-body", ".post-content", ".entry-content", ".content-body", "[itemprop='articleBody']"];
    let bodyText = "";

    for (const selector of articleSelectors) {
      const text = $(selector).text().replace(/\s+/g, " ").trim();
      if (text.length > 200) {
        bodyText = text;
        break;
      }
    }

    if (!bodyText) {
      bodyText = $("body").text().replace(/\s+/g, " ").trim();
    }

    if (!bodyText || bodyText.length < 100) {
      return null;
    }

    const content = title ? `Title: ${title}\n\n${bodyText}` : bodyText;
    return content.slice(0, MAX_CONTENT_CHARS);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaJina(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers: { Accept: "text/plain" },
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    return text.slice(0, MAX_CONTENT_CHARS) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SUMMARY_SYSTEM = [
  "You are ClawCloud AI summarising a URL for a WhatsApp user.",
  "Write a clean, concise summary in WhatsApp format (*bold* for key points, bullets for lists).",
  "Structure: 1-2 sentence overview, then 3-5 key points as bullets.",
  "End with: 'Want me to explain any part in more detail?'",
  "Keep total response under 400 words.",
  "Never make up facts not in the provided content.",
].join("\n");

async function summariseContent(url: string, content: string, userQuestion: string): Promise<string> {
  const isYouTube = /youtu/.test(url);
  const contentType = isYouTube ? "YouTube video transcript" : "web article";

  const answer = await completeClawCloudPrompt({
    system: SUMMARY_SYSTEM,
    user: [
      `URL: ${url}`,
      `User asked: ${userQuestion || "Summarise this"}`,
      "",
      `--- ${contentType} content ---`,
      content,
      "--- end ---",
    ].join("\n"),
    intent: "research",
    responseMode: "fast",
    maxTokens: 600,
    fallback: "",
    temperature: 0.2,
  });

  return answer.trim();
}

export async function handleUrlMessage(message: string): Promise<string | null> {
  const urls = extractUrlsFromMessage(message);
  if (!urls.length) {
    return null;
  }

  const url = urls[0];
  const userQuestion = message.replace(URL_PATTERN, "").trim() || "Summarise this";

  console.log(`[url-reader] Processing: ${url}`);

  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    const transcript = await fetchYouTubeTranscript(youtubeId);
    if (transcript) {
      const summary = await summariseContent(url, transcript, userQuestion);
      return summary ? `📺 *YouTube Summary*\n\n${summary}` : null;
    }

    return [
      "📺 *YouTube video received*",
      "",
      "I couldn't access the transcript for this video (it may not have captions enabled).",
      "",
      "You can still ask me about the topic and I'll answer from my knowledge!",
    ].join("\n");
  }

  let content = await fetchArticleText(url);
  if (!content || content.length < 100) {
    content = await fetchViaJina(url);
  }

  if (!content || content.length < 100) {
    return [
      "🔗 *URL received*",
      "",
      "I couldn't read the content of this page (it may be behind a login, paywall, or use JavaScript rendering).",
      "",
      "You can copy-paste the article text and I'll summarise it for you!",
    ].join("\n");
  }

  const summary = await summariseContent(url, content, userQuestion);
  return summary ? `🔗 *Summary*\n\n${summary}` : null;
}
