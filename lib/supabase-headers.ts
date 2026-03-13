function isJwtLikeKey(value: string) {
  return value.split(".").length === 3;
}

export function buildSupabaseHeaders(apiKey: string, headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);

  nextHeaders.set("apikey", apiKey);

  if (isJwtLikeKey(apiKey)) {
    nextHeaders.set("Authorization", `Bearer ${apiKey}`);
  } else {
    nextHeaders.delete("Authorization");
  }

  if (!nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }

  return nextHeaders;
}
