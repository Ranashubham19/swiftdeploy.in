"use client";

import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth } from "firebase/auth";

import type { PublicAppConfig } from "@/lib/types";

const APP_NAME = "swiftdeploy-ai-research-agent";

function resolveApp(config: PublicAppConfig["firebase"]): FirebaseApp {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) {
    return existing;
  }

  try {
    return getApp(APP_NAME);
  } catch {
    return initializeApp(config, APP_NAME);
  }
}

export function getFirebaseAuth(config: PublicAppConfig["firebase"]): Auth {
  return getAuth(resolveApp(config));
}
