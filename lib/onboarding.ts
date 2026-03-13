const onboardingCompleteStorageKey = "clawcloud.onboarding.complete";

export function isOnboardingComplete() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(onboardingCompleteStorageKey) === "true";
}

export function getPostAuthRedirectPath() {
  return isOnboardingComplete() ? "/dashboard" : "/setup";
}

export function markOnboardingComplete() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(onboardingCompleteStorageKey, "true");
}
