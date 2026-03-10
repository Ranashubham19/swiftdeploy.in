import test from "node:test";
import assert from "node:assert/strict";
import { buildVisionUserContent, injectLatestUserVisionMessage } from "../src/visionMessage.js";

test("photo vision flow builds text+image parts and filters invalid URLs", () => {
  const parts = buildVisionUserContent("Analyze this", [
    "https://example.com/a.jpg",
    "not-a-url",
    "https://example.com/a.jpg",
    "http://example.com/b.png",
  ]);

  assert.equal(parts[0]?.type, "text");
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.slice(1).map((p: any) => p.image_url.url), [
    "https://example.com/a.jpg",
    "http://example.com/b.png",
  ]);
});

test("photo vision flow replaces latest user message with multimodal payload", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "old prompt" },
    { role: "assistant", content: "answer" },
    { role: "user", content: "caption" },
  ] as const;

  const next = injectLatestUserVisionMessage(
    messages as any,
    "caption",
    ["https://example.com/image.jpg"],
  );

  const last = next[next.length - 1] as any;
  assert.equal(last.role, "user");
  assert.ok(Array.isArray(last.content));
  assert.equal(last.content[0].text, "caption");
  assert.equal(last.content[1].image_url.url, "https://example.com/image.jpg");
});
