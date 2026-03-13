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

async function runResearch(payload) {
  const response = await fetch(`${baseUrl}/api/research`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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

const scenarios = [
  {
    key: "greeting",
    payload: {
      question: "hello",
      history: [],
      user: null,
    },
    verify(result) {
      assert(result.classification?.type === "greeting", "Greeting classification mismatch");
    },
  },
  {
    key: "search",
    payload: {
      question: "What are the latest major AI developments this week?",
      history: [],
      user: null,
    },
    verify(result) {
      assert(result.classification?.mode === "search", "Search mode mismatch");
      assert((result.sources || []).length > 0, "Search scenario returned no sources");
      assert(result.answer?.markdown, "Search scenario returned no markdown");
    },
  },
  {
    key: "follow_up_memory",
    payload: {
      question: "What about Delhi?",
      history: [
        {
          role: "user",
          content: "What is the latest LPG cylinder price in India?",
        },
        {
          role: "assistant",
          content: "Prices vary by city and the latest answer should be checked against public sources.",
        },
      ],
      user: null,
    },
    verify(result) {
      assert(result.usedConversationContext, "Follow-up scenario did not use conversation context");
      assert(
        /Delhi/i.test(result.resolvedQuestion) && /LPG|cylinder|price/i.test(result.resolvedQuestion),
        `Unexpected resolved question: ${result.resolvedQuestion}`,
      );
    },
  },
  {
    key: "research",
    payload: {
      question: "Compare Tavily and SerpAPI for production research workflows.",
      history: [],
      user: null,
    },
    verify(result) {
      assert(result.classification?.mode === "research", "Research mode mismatch");
      assert(result.answer?.markdown, "Research scenario returned no markdown");
    },
  },
  {
    key: "website",
    payload: {
      question: "Analyze https://www.openai.com and summarize the homepage messaging.",
      history: [],
      user: null,
    },
    verify(result) {
      assert(result.classification?.mode === "website", "Website mode mismatch");
      assert((result.sources || []).length > 0, "Website scenario returned no sources");
    },
  },
  {
    key: "document",
    payload: {
      question: "What does this document say about prohibited content? https://openai.com/policies/usage-policies",
      history: [],
      user: null,
    },
    verify(result) {
      assert(result.classification?.mode === "document", "Document mode mismatch");
      assert(result.answer?.markdown, "Document scenario returned no markdown");
    },
  },
  {
    key: "coding",
    payload: {
      question: "Write a TypeScript helper that groups records by key with proper types.",
      history: [],
      user: null,
    },
    verify(result) {
      assert(result.classification?.mode === "code", "Coding mode mismatch");
      assert(result.answer?.summary, "Coding scenario returned no summary");
    },
  },
];

const report = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  results: [],
};

for (const scenario of scenarios) {
  const result = await runResearch(scenario.payload);
  scenario.verify(result);
  report.results.push({
    key: scenario.key,
    type: result.classification?.type,
    mode: result.classification?.mode,
    resolvedQuestion: result.resolvedQuestion,
    usedConversationContext: result.usedConversationContext,
    sourceCount: result.sources?.length ?? 0,
    retrievedCount: result.retrievedContext?.length ?? 0,
    title: result.answer?.title,
  });
}

console.log(JSON.stringify(report, null, 2));
