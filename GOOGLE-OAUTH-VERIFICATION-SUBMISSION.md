# Google OAuth Verification Submission Pack

Use this file when filling Google Auth Platform -> Data access and Verification Center.
It is written to match the current production behavior in this repo.

## Production values

- App name: `ClawCloud`
- App home page: `https://swift-deploy.in`
- Public reviewer path: `https://swift-deploy.in/verify/google-oauth`
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
GOOGLE_WORKSPACE_SETUP_LITE_ONLY=false
```

## Scopes used by the app

### Core launch scopes

- `https://www.googleapis.com/auth/calendar.events`
  Used to read the connected user's upcoming events and to create, update, or cancel calendar
  events only when the connected user explicitly asks ClawCloud to manage their schedule.

- `https://www.googleapis.com/auth/gmail.modify`
  Used to read the connected user's inbox messages and metadata when the user asks for inbox help
  such as unread message lookup, reply suggestions, meeting preparation, and receipt-based
  spending summaries. It also supports user-requested inbox actions such as marking messages read
  or unread, archiving, restoring, or moving messages to trash.

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

`ClawCloud uses calendar.events to read the connected user's calendar context and to create, update, or cancel events only when the connected user explicitly asks for schedule management. ClawCloud uses gmail.send only after the connected user explicitly approves or requests a reply. The app does not send bulk email, market to contacts, or auto-send messages without a user action. Access is limited to the connected account and supports the product's inbox assistant, meeting briefing, and user-requested scheduling features.`

### Restricted scopes category

For Gmail restricted scopes, choose:

`Email client and Email productivity`

### Restricted scopes text

Paste this into the "How will the restricted scopes be used?" field for Gmail modify and compose:

`ClawCloud uses gmail.modify to search and read only the connected user's inbox messages when the user asks for inbox help, meeting context, unread message lookup, reply suggestions, or spending summaries from emailed receipts. The same scope is used for user-requested inbox actions such as marking messages read or unread, archiving, restoring, or moving them to trash. ClawCloud uses gmail.compose to create or update draft replies and prepare user-requested email drafts. The app does not use these scopes for advertising, data sale, or unrelated profiling. Access is scoped to the connected account, tokens are encrypted at rest, and users can disconnect Google access at any time.`

## Demo video checklist

Record an unlisted YouTube video that shows this full flow:

1. Open `https://swift-deploy.in/setup`.
2. If needed, first open `https://swift-deploy.in/auth` and click "Continue with Google".
3. Return to `https://swift-deploy.in/setup` and start the Gmail + Calendar consent flow.
4. Show the Google consent screen and the exact scopes requested.
5. Complete consent with a test Google account.
6. Return to ClawCloud and show Gmail + Calendar connected.
7. Ask ClawCloud to find unread email or summarize recent inbox messages.
8. Show one user-requested inbox action such as mark read, archive, or move to trash.
9. Ask ClawCloud a calendar question such as today's meetings or next meeting, then show one
   user-requested calendar action such as creating or rescheduling an event.
10. Show the reply approval flow or a draft creation flow.
11. If you are requesting `gmail.send`, show the explicit user approval step before send.
12. Show how the user can disconnect Google access from settings.

## Notes for Verification Center

- Be consistent: the branding page, privacy policy, scope list, and demo video must all describe the
  same behavior.
- In the reviewer email thread, send `https://swift-deploy.in/verify/google-oauth` as the public test
  entry and mention that the exact Gmail + Calendar consent flow starts after Google sign-in on
  `/auth`, then continues on `/setup`.
- Do not mention Drive / Sheets as publicly available until `GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED`
  is intentionally turned on.
- If Google asks why narrower scopes are not sufficient, explain that:
  - `gmail.modify` is required because ClawCloud supports both inbox reading and user-requested
    inbox actions like marking messages read/unread, archiving, restoring, or moving them to trash.
  - `gmail.compose` is required to create drafts.
  - `gmail.send` is required only for user-approved sending.
  - `calendar.events` is required because ClawCloud supports user-requested event creation,
    rescheduling, and cancellation in addition to calendar reading.

## After approval

1. Turn on core public access in production:

```env
GOOGLE_WORKSPACE_PUBLIC_ENABLED=true
GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED=false
GOOGLE_WORKSPACE_TEMPORARY_HOLD=false
GOOGLE_WORKSPACE_SETUP_LITE_ONLY=false
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
