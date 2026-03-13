const baseUrl = process.env.SWIFTDEPLOY_BASE_URL || "http://localhost:3000";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseEventBlock(block) {
  const lines = block.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!eventLine || !dataLine) {
    return null;
  }

  return {
    event: eventLine.slice(6).trim(),
    data: JSON.parse(dataLine.slice(5).trim()),
  };
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function runResearch(question) {
  const response = await fetch(`${baseUrl}/api/research`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      question,
      history: [],
      user: null,
    }),
  });

  assert(response.ok, `/api/research failed with ${response.status}`);
  assert(response.body, "Research response did not include a stream body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");

    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      const event = parseEventBlock(block);
      if (!event) {
        continue;
      }

      if (event.event === "error") {
        throw new Error(event.data?.message || "Research stream returned an error");
      }

      if (event.event === "complete") {
        completed = event.data;
      }
    }
  }

  assert(completed, "Research stream completed without a final payload");
  return completed;
}

const summary = {
  checkedAt: new Date().toISOString(),
  baseUrl,
};

const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
assert(health.ok, "Health route did not return ok=true");
summary.health = {
  ok: health.ok,
  providerCount: Object.values(health.providers || {}).filter(Boolean).length,
  pineconeIndex: health.storage?.pineconeIndex,
};

const search = await postJson("/api/search", {
  query: "latest major AI developments this week",
});
assert(search.response.ok, `/api/search failed with ${search.response.status}`);
assert((search.payload.results || []).length > 0, "Search returned no results");
summary.search = {
  count: search.payload.count,
  topTitle: search.payload.results?.[0]?.title,
};

const crawl = await postJson("/api/crawl", {
  url: "https://www.openai.com",
  title: "OpenAI",
});
assert(crawl.response.ok, `/api/crawl failed with ${crawl.response.status}`);
assert(crawl.payload.ok, "Crawl returned ok=false");
assert(crawl.payload.document?.content?.length > 150, "Crawl content was too short");
summary.crawl = {
  provider: crawl.payload.document?.provider,
  title: crawl.payload.document?.title,
  contentLength: crawl.payload.document?.content?.length,
};

const embed = await postJson("/api/embed", {
  texts: ["SwiftDeploy research assistant"],
  inputType: "query",
});
assert(embed.response.ok, `/api/embed failed with ${embed.response.status}`);
assert((embed.payload.dimensions || 0) > 0, "Embedding dimensions were zero");
summary.embed = {
  dimensions: embed.payload.dimensions,
  count: embed.payload.count,
};

const research = await runResearch("What are the latest major AI developments this week?");
assert((research.sources || []).length > 0, "Research returned no sources");
assert(research.answer?.markdown, "Research returned no answer markdown");
summary.research = {
  classification: research.classification?.type,
  mode: research.classification?.mode,
  sourceCount: research.sources?.length,
  retrievedCount: research.retrievedContext?.length,
  answerTitle: research.answer?.title,
};

const retrieve = await postJson("/api/retrieve", {
  question: "What are the latest major AI developments this week?",
  limit: 4,
});
assert(retrieve.response.ok, `/api/retrieve failed with ${retrieve.response.status}`);
summary.retrieve = {
  count: retrieve.payload.count,
};

const threadsResponse = await fetch(`${baseUrl}/api/threads?userId=smoke-test`);
const threadsPayload = await threadsResponse.json().catch(() => ({}));
summary.threads = {
  status: threadsResponse.status,
  synced: threadsPayload.persistence?.synced ?? false,
  reason: threadsPayload.persistence?.reason ?? null,
};

console.log(JSON.stringify(summary, null, 2));
