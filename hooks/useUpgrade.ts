"use client";

import { useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type UpgradeInput = {
  plan: "starter" | "pro";
  period?: "monthly" | "annual";
  currency?: "usd" | "inr";
};

type UseUpgradeReturn = {
  upgrade: (input: UpgradeInput) => Promise<void>;
  openPortal: () => Promise<void>;
  loading: boolean;
  error: string | null;
};

async function getAuthToken() {
  const supabase = getSupabaseBrowserClient({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  });
  if (!supabase) {
    return null;
  }

  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useUpgrade(): UseUpgradeReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgrade(input: UpgradeInput) {
    setLoading(true);
    setError(null);

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error("Not authenticated. Please sign in first.");
      }

      const currency = input.currency ?? "usd";
      const period = input.period ?? "monthly";
      const endpoint =
        currency === "inr"
          ? "/api/payments/razorpay/checkout"
          : "/api/payments/stripe/checkout";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: input.plan,
          period,
          currency,
        }),
      });

      const json = (await response.json().catch(() => ({}))) as {
        url?: string;
        paymentUrl?: string;
        error?: string;
      };

      if (!response.ok || json.error) {
        throw new Error(json.error || "Checkout failed.");
      }

      window.location.href = json.url || json.paymentUrl || "";
    } catch (error) {
      setError(error instanceof Error ? error.message : "Payment failed.");
    } finally {
      setLoading(false);
    }
  }

  async function openPortal() {
    setLoading(true);
    setError(null);

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error("Not authenticated.");
      }

      const response = await fetch("/api/payments/stripe/portal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };

      if (!response.ok || json.error || !json.url) {
        throw new Error(json.error || "Could not open billing portal.");
      }

      window.location.href = json.url;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Portal failed.");
    } finally {
      setLoading(false);
    }
  }

  return { upgrade, openPortal, loading, error };
}
