import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseBrowserConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

let cachedClient: SupabaseClient | null = null;
let cachedKey = "";

export function getSupabaseBrowserClient(config: SupabaseBrowserConfig) {
  const { supabaseUrl, supabaseAnonKey } = config;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const nextKey = `${supabaseUrl}::${supabaseAnonKey}`;
  if (cachedClient && cachedKey === nextKey) {
    return cachedClient;
  }

  cachedKey = nextKey;
  cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });

  return cachedClient;
}
