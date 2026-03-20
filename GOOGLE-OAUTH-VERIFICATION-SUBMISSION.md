# Google OAuth Verification Submission Pack

Use this file when filling Google Auth Platform -> Data access and Verification Center.
It is written to match the current production behavior in this repo.

## Production values

- App name: `ClawCloud`
- App home page: `https://swift-deploy.in`
- Privacy policy: `https://swift-deploy.in/privacy`
- Terms of service: `https://swift-deploy.in/terms`
- Authorized domain: `swift-deploy.in`
- OAuth redirect URI: `https://swift-deploy.in/api/auth/google/callback`

## Phase 1 launch recommendation

Submit and launch Gmail + Calendar first.
Keep Drive / Sheets behind the separate rollout flag until Google approves those extended scopes too.

Production flags for this phased launch:

```env
GOOGLE_WORKSPACE_PUBLIC_ENABLED=true
GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED=false
GOOGLE_WORKSPACE_TEMPORARY_HOLD=false
```

## Scopes used by the app

### Core launch scopes

- `https://www.googleapis.com/auth/calendar.readonly`
  Used to read the connected user's upcoming events so ClawCloud can answer schedule questions,
  prepare meeting reminders, generate meeting context, and produce daily planning summaries.

- `https://www.googleapis.com/auth/gmail.readonly`
  Used to read only the connected user's inbox messages and metadata when the user asks for inbox
  help such as unread message lookup, reply suggestions, meeting preparation, and receipt-based
  spending summaries.

- `https://www.googleapis.com/auth/gmail.compose`
  Used to create or update Gmail drafts prepared by ClawCloud for the connected user.

- `https://www.googleapis.com/auth/gmail.send`
  Used only when the connected user explicitly approves or requests sending a reply.

- `email`
- `profile`

### Extended later scopes

- `https://www.googleapis.com/auth/drive.readonly`
  Used to list, search, and read Google Drive files the user asks about.

- `https://www.googleapis.com/auth/spreadsheets`
  Used to read spreadsheet content and append rows when the user explicitly asks ClawCloud to add
  data to a Google Sheet.

## Exact text for Google Data access

### Sensitive scopes text

Paste this into the "How will the sensitive scopes be used?" field for Calendar and Gmail send:

`ClawCloud uses calendar.readonly to fetch only the connected user's upcoming events from their primary Google Calendar so it can answer schedule questions, prepare meeting reminders, and build meeting context. ClawCloud uses gmail.send only after the connected user explicitly approves or requests a reply. The app does not send bulk email, market to contacts, or auto-send messages without a user action. Access is limited to the connected account and supports the product's inbox assistant and meeting briefing features.`

### Restricted scopes category

For Gmail restricted scopes, choose:

`Email client and Email productivity`

### Restricted scopes text

Paste this into the "How will the restricted scopes be used?" field for Gmail readonly and compose:

`ClawCloud uses gmail.readonly to search and read only the connected user's inbox messages when the user asks for inbox help, meeting context, unread message lookup, reply suggestions, or spending summaries from emailed receipts. ClawCloud uses gmail.compose to create or update draft replies and prepare user-requested email drafts. The app does not use these scopes for advertising, data sale, or unrelated profiling. Access is scoped to the connected account, tokens are encrypted at rest, and users can disconnect Google access at any time.`

## Demo video checklist

Record an unlisted YouTube video that shows this full flow:

1. Open `https://swift-deploy.in/setup`.
2. Click "Continue with Google".
3. Show the Google consent screen and the exact scopes requested.
4. Complete consent with a test Google account.
5. Return to ClawCloud and show Gmail + Calendar connected.
6. Ask ClawCloud to find unread email or summarize recent inbox messages.
7. Ask ClawCloud a calendar question such as today's meetings or next meeting.
8. Show the reply approval flow or a draft creation flow.
9. If you are requesting `gmail.send`, show the explicit user approval step before send.
10. Show how the user can disconnect Google access from settings.

## Notes for Verification Center

- Be consistent: the branding page, privacy policy, scope list, and demo video must all describe the
  same behavior.
- Do not mention Drive / Sheets as publicly available until `GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED`
  is intentionally turned on.
- If Google asks why narrower scopes are not sufficient, explain that:
  - `gmail.readonly` is required to search and read message content for inbox assistance.
  - `gmail.compose` is required to create drafts.
  - `gmail.send` is required only for user-approved sending.
  - `calendar.readonly` is required to read upcoming events without editing calendars.

## After approval

1. Turn on core public access in production:

```env
GOOGLE_WORKSPACE_PUBLIC_ENABLED=true
GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED=false
GOOGLE_WORKSPACE_TEMPORARY_HOLD=false
```

2. Redeploy.

3. Verify:
   - `https://swift-deploy.in/api/auth/google/provider-health`
   - `workspace.ok` should be `true`
   - `workspace.extended.ok` should stay `false` until you intentionally launch Drive / Sheets

4. Only after Google approves the extended Drive / Sheets scopes, change:

```env
GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED=true
```
