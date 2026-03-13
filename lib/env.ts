import type { ProviderSnapshot, PublicAppConfig } from "@/lib/types";

function readString(name: string, fallback = "") {
  return process.env[name]?.trim() ?? fallback;
}

function readFirstString(names: string[], fallback = "") {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return fallback;
}

function readNumber(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export const env = {
  NVIDIA_API_KEY: readString("NVIDIA_API_KEY"),
  NVIDIA_BASE_URL: readString(
    "NVIDIA_BASE_URL",
    "https://integrate.api.nvidia.com/v1",
  ),
  NVIDIA_CHAT_MODEL: readFirstString(
    ["NVIDIA_CHAT_MODEL", "NVIDIA_MODEL"],
    "meta/llama-3.1-8b-instruct",
  ),
  NVIDIA_FAST_MODEL: readString("NVIDIA_FAST_MODEL"),
  NVIDIA_REASONING_MODEL: readString("NVIDIA_REASONING_MODEL"),
  NVIDIA_CODE_MODEL: readString("NVIDIA_CODE_MODEL"),
  NVIDIA_REPORT_MODEL: readString("NVIDIA_REPORT_MODEL"),
  NVIDIA_EMBED_MODEL: readString(
    "NVIDIA_EMBED_MODEL",
    "nvidia/llama-3.2-nemoretriever-300m-embed-v1",
  ),
  TAVILY_API_KEY: readString("TAVILY_API_KEY"),
  FIRECRAWL_API_KEY: readString("FIRECRAWL_API_KEY"),
  APIFY_API_TOKEN: readString("APIFY_API_TOKEN"),
  BRIGHTDATA_API_KEY: readString("BRIGHTDATA_API_KEY"),
  BRIGHTDATA_ZONE: readString("BRIGHTDATA_ZONE"),
  SERPAPI_API_KEY: readString("SERPAPI_API_KEY"),
  SCRAPERAPI_KEY: readString("SCRAPERAPI_KEY"),
  JINA_API_KEY: readString("JINA_API_KEY"),
  COHERE_API_KEY: readString("COHERE_API_KEY"),
  VOYAGE_API_KEY: readString("VOYAGE_API_KEY"),
  VOYAGE_EMBED_MODEL: readString("VOYAGE_EMBED_MODEL", "voyage-3.5-lite"),
  PINECONE_API_KEY: readString("PINECONE_API_KEY"),
  PINECONE_INDEX_NAME: readString("PINECONE_INDEX_NAME", "swiftdeploy-ai-assistant"),
  PINECONE_NAMESPACE: readString("PINECONE_NAMESPACE", "research"),
  PINECONE_CLOUD: readString("PINECONE_CLOUD", "aws"),
  PINECONE_REGION: readString("PINECONE_REGION", "us-east-1"),
  WEAVIATE_HOST: readString("WEAVIATE_HOST"),
  WEAVIATE_API_KEY: readString("WEAVIATE_API_KEY"),
  RESEARCH_WEAVIATE_CLASS: readString("RESEARCH_WEAVIATE_CLASS", "ResearchChunk"),
  RESEARCH_MAX_SOURCES: readNumber("RESEARCH_MAX_SOURCES", 8),
  RESEARCH_MAX_SEARCH_RESULTS: readNumber("RESEARCH_MAX_SEARCH_RESULTS", 24),
  RESEARCH_MAX_SEARCH_QUERIES: readNumber("RESEARCH_MAX_SEARCH_QUERIES", 4),
  RESEARCH_MAX_CHUNKS_PER_SOURCE: readNumber(
    "RESEARCH_MAX_CHUNKS_PER_SOURCE",
    5,
  ),
  RESEARCH_RETRIEVE_LIMIT: readNumber("RESEARCH_RETRIEVE_LIMIT", 8),
  SUPABASE_URL: readFirstString(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
  SUPABASE_ANON_KEY: readFirstString([
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]),
  SUPABASE_SERVICE_ROLE_KEY: readString("SUPABASE_SERVICE_ROLE_KEY"),
  SUPABASE_PERSISTENCE_TABLE: readString(
    "SUPABASE_PERSISTENCE_TABLE",
    "research_runs",
  ),
  SUPABASE_THREADS_TABLE: readString("SUPABASE_THREADS_TABLE", "chat_threads"),
  OPENAI_API_KEY: readString("OPENAI_API_KEY"),
  OPENAI_MODEL: readString("OPENAI_MODEL", "gpt-4o-mini"),
  STRIPE_SECRET_KEY: readString("STRIPE_SECRET_KEY"),
  STRIPE_WEBHOOK_SECRET: readString("STRIPE_WEBHOOK_SECRET"),
  STRIPE_PRICE_STARTER_MONTHLY_USD: readString("STRIPE_PRICE_STARTER_MONTHLY_USD"),
  STRIPE_PRICE_STARTER_ANNUAL_USD: readString("STRIPE_PRICE_STARTER_ANNUAL_USD"),
  STRIPE_PRICE_STARTER_MONTHLY_INR: readString("STRIPE_PRICE_STARTER_MONTHLY_INR"),
  STRIPE_PRICE_STARTER_ANNUAL_INR: readString("STRIPE_PRICE_STARTER_ANNUAL_INR"),
  STRIPE_PRICE_PRO_MONTHLY_USD: readString("STRIPE_PRICE_PRO_MONTHLY_USD"),
  STRIPE_PRICE_PRO_ANNUAL_USD: readString("STRIPE_PRICE_PRO_ANNUAL_USD"),
  STRIPE_PRICE_PRO_MONTHLY_INR: readString("STRIPE_PRICE_PRO_MONTHLY_INR"),
  STRIPE_PRICE_PRO_ANNUAL_INR: readString("STRIPE_PRICE_PRO_ANNUAL_INR"),
  RAZORPAY_KEY_ID: readString("RAZORPAY_KEY_ID"),
  RAZORPAY_KEY_SECRET: readString("RAZORPAY_KEY_SECRET"),
  RAZORPAY_WEBHOOK_SECRET: readString("RAZORPAY_WEBHOOK_SECRET"),
  RAZORPAY_PLAN_STARTER_MONTHLY: readString("RAZORPAY_PLAN_STARTER_MONTHLY"),
  RAZORPAY_PLAN_STARTER_ANNUAL: readString("RAZORPAY_PLAN_STARTER_ANNUAL"),
  RAZORPAY_PLAN_PRO_MONTHLY: readString("RAZORPAY_PLAN_PRO_MONTHLY"),
  RAZORPAY_PLAN_PRO_ANNUAL: readString("RAZORPAY_PLAN_PRO_ANNUAL"),
  AGENT_SERVER_URL: readString("AGENT_SERVER_URL"),
  AGENT_SECRET: readString("AGENT_SECRET"),
  NEXT_PUBLIC_APP_URL: readFirstString(["NEXT_PUBLIC_APP_URL", "NEXTJS_URL"]),
  NEXTJS_URL: readString("NEXTJS_URL"),
  GOOGLE_CLIENT_ID: readFirstString(["GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"]),
  GOOGLE_CLIENT_SECRET: readFirstString([
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_CLIENT_SECRET",
  ]),
  GOOGLE_REDIRECT_URI: readString("GOOGLE_REDIRECT_URI"),
  TELEGRAM_BOT_TOKEN: readString("TELEGRAM_BOT_TOKEN"),
  TELEGRAM_BOT_USERNAME: readString("TELEGRAM_BOT_USERNAME"),
  TELEGRAM_WEBHOOK_SECRET: readString("TELEGRAM_WEBHOOK_SECRET"),
  CRON_SECRET: readString("CRON_SECRET"),
  WA_SESSION_DIR: readString("WA_SESSION_DIR"),
  FIREBASE_API_KEY: readString(
    "FIREBASE_API_KEY",
    "AIzaSyBxpkdPyNxjmdTK_g7KAO_c99LwhjqXX_E",
  ),
  FIREBASE_AUTH_DOMAIN: readString(
    "FIREBASE_AUTH_DOMAIN",
    "iftdeploy.firebaseapp.com",
  ),
  FIREBASE_PROJECT_ID: readString("FIREBASE_PROJECT_ID", "iftdeploy"),
  FIREBASE_STORAGE_BUCKET: readString(
    "FIREBASE_STORAGE_BUCKET",
    "iftdeploy.firebasestorage.app",
  ),
  FIREBASE_MESSAGING_SENDER_ID: readString(
    "FIREBASE_MESSAGING_SENDER_ID",
    "344733068205",
  ),
  FIREBASE_APP_ID: readString(
    "FIREBASE_APP_ID",
    "1:344733068205:web:bdacee7b1ba3f4917ccf24",
  ),
  FIREBASE_MEASUREMENT_ID: readString(
    "FIREBASE_MEASUREMENT_ID",
    "G-6LBM2T2XLS",
  ),
  LANGSMITH_API_KEY: readString("LANGSMITH_API_KEY"),
  LANGSMITH_PROJECT: readString("LANGSMITH_PROJECT", "swiftdeploy-ai-assistant"),
};

export function getProviderSnapshot(): ProviderSnapshot {
  return {
    tavily: Boolean(env.TAVILY_API_KEY),
    serpapi: Boolean(env.SERPAPI_API_KEY),
    firecrawl: Boolean(env.FIRECRAWL_API_KEY),
    apify: Boolean(env.APIFY_API_TOKEN),
    brightdata: Boolean(env.BRIGHTDATA_API_KEY && env.BRIGHTDATA_ZONE),
    scraperapi: Boolean(env.SCRAPERAPI_KEY),
    weaviate: Boolean(env.WEAVIATE_HOST && env.WEAVIATE_API_KEY),
    jina: Boolean(env.JINA_API_KEY),
    cohere: Boolean(env.COHERE_API_KEY),
    voyage: Boolean(env.VOYAGE_API_KEY),
    pinecone: Boolean(env.PINECONE_API_KEY),
    nvidia: Boolean(env.NVIDIA_API_KEY),
    supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
    firebase: Boolean(env.FIREBASE_API_KEY),
    langsmith: Boolean(env.LANGSMITH_API_KEY),
  };
}

export function getPublicAppConfig(): PublicAppConfig {
  return {
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    firebase: {
      apiKey: env.FIREBASE_API_KEY,
      authDomain: env.FIREBASE_AUTH_DOMAIN,
      projectId: env.FIREBASE_PROJECT_ID,
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
      appId: env.FIREBASE_APP_ID,
      measurementId: env.FIREBASE_MEASUREMENT_ID,
    },
    providerSnapshot: getProviderSnapshot(),
  };
}
