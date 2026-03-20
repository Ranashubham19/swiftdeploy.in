# Google OAuth Public Launch Checklist

This app now keeps Google Workspace connect disabled for public users by default in production.
That prevents users from being dropped into Google's raw "unverified app" warning until the app
has been approved.

## What changed in code

- Public Gmail / Calendar connect is now opt-in via `GOOGLE_WORKSPACE_PUBLIC_ENABLED=true`.
- Public Drive / Sheets reconnect is separately opt-in via `GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED=true`.
- Local development still works without extra rollout flags.
- Setup only requests Gmail + Calendar scopes first.
- Drive / Sheets scopes are requested later via reconnect from Settings.

## Required before enabling for all users

1. In Google Cloud Console, configure the OAuth consent screen for an external production app.
2. Verify ownership of the production domain used by the app.
3. Ensure these production URLs are live and accurate:
   - Homepage: `https://swift-deploy.in/`
   - Privacy policy: `https://swift-deploy.in/privacy`
   - Terms: `https://swift-deploy.in/terms`
4. Confirm the support / developer contact emails in Google Cloud Console are monitored.
5. Submit the app for OAuth verification for every scope requested by the production flow.
6. If Google flags any requested scope as restricted, complete any additional assessment Google
   requires before public launch.
7. After approval, enable the rollout flags in production:
   - `GOOGLE_WORKSPACE_PUBLIC_ENABLED=true`
   - `GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED=true` once the extended Drive / Sheets review is approved
   - `GOOGLE_WORKSPACE_TEMPORARY_HOLD=false`
8. Re-test:
   - Setup > Gmail / Calendar connect
   - Settings > Reconnect Google for Drive / Sheets
   - Google sign-in, if that rollout is also being opened publicly

## Recommended production flags before approval

```env
GOOGLE_WORKSPACE_PUBLIC_ENABLED=false
GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED=false
GOOGLE_WORKSPACE_TEMPORARY_HOLD=true
```

## Recommended production flags after approval

```env
GOOGLE_WORKSPACE_PUBLIC_ENABLED=true
GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED=true
GOOGLE_WORKSPACE_TEMPORARY_HOLD=false
```
