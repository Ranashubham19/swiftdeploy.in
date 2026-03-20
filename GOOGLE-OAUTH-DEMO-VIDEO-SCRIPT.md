# Google OAuth Demo Video Script

Use this script to record the unlisted YouTube demo video Google asks for in OAuth verification.
It is written to match the current ClawCloud product and scope request flow.

## Goal

Show Google that ClawCloud:

- requests only the Gmail and Calendar scopes needed for the current public launch
- uses Gmail to read inbox content, create drafts, and send only with user intent
- uses Calendar in read-only mode for schedule questions and reminders
- allows the user to disconnect Google access

Do not show Drive or Sheets in this video.

## Recording settings

- Resolution: `1920x1080`
- Visibility: `Unlisted`
- Length target: `2 to 4 minutes`
- Microphone: optional, but recommended
- Browser: Chrome
- Zoom: 100 percent
- Turn off unrelated tabs, notifications, and bookmarks if possible

## Before you record

1. Use a test Google account with Gmail and Calendar data.
2. Make sure the app is running at `https://swift-deploy.in`.
3. Make sure the account can sign in and reach the setup flow.
4. If possible, prepare:
   - at least one recent unread email
   - at least one upcoming calendar event
5. Open these tabs in advance:
   - `https://swift-deploy.in/setup`
   - `https://swift-deploy.in/settings`
   - `https://swift-deploy.in/approvals`

## Suggested YouTube title

`ClawCloud Google OAuth Verification Demo - Gmail and Calendar Scope Usage`

## Suggested YouTube description

`This video demonstrates how ClawCloud uses Google OAuth scopes in production. The app requests Gmail readonly, Gmail compose, Gmail send, and Calendar readonly to help the connected user search inbox messages, create drafts, send only user-approved replies, and answer schedule questions from the user's primary Google Calendar.`

## One-take video outline

### Scene 1: Landing on setup

Time: `0:00 to 0:20`

On screen:

1. Open `https://swift-deploy.in/setup`.
2. Show the card titled `Connect Gmail and Calendar`.
3. Pause long enough for Google to see the UI text.

Say:

`This is ClawCloud. In this demo I will show how the app uses Gmail and Google Calendar access for the connected user. The current public launch requests Gmail readonly, Gmail compose, Gmail send, and Calendar readonly.`

### Scene 2: Start OAuth

Time: `0:20 to 0:45`

On screen:

1. Click `Continue with Google`.
2. Let the Google consent screen load fully.
3. Slowly scroll if needed so the requested permissions are visible.

Say:

`ClawCloud starts OAuth from the setup flow. The app requests access only for inbox assistance and calendar-based planning. Gmail send is used only after the user explicitly asks to send or approves a prepared reply.`

### Scene 3: Show consent screen and scopes

Time: `0:45 to 1:10`

On screen:

1. Keep the consent screen visible.
2. Highlight the permissions.
3. Continue with the test account.

Say:

`Here Google shows the scopes requested by ClawCloud. Gmail readonly is used to search and summarize the user's inbox. Gmail compose is used to prepare draft replies. Gmail send is used only for user-approved sending. Calendar readonly is used to read upcoming events without editing the user's calendar.`

### Scene 4: Return to ClawCloud after consent

Time: `1:10 to 1:30`

On screen:

1. Complete consent.
2. Return to ClawCloud.
3. Show that Gmail and Calendar are connected in setup or settings.

Say:

`After consent, ClawCloud stores the encrypted tokens for the connected account and uses them only for the inbox and meeting-assistant features the user enabled.`

### Scene 5: Show inbox assistance

Time: `1:30 to 2:05`

On screen:

Use the product area that best demonstrates inbox usage. Show one of these clearly:

1. Search inbox or unread email lookup in the app
2. A generated inbox summary
3. Draft replies or reply approvals generated from inbox messages

If using the approvals page:

1. Open `https://swift-deploy.in/approvals`
2. Trigger draft generation if needed
3. Show pending drafted replies

Say:

`This is the Gmail readonly and compose usage. ClawCloud reads only the connected user's inbox when the user asks for inbox help or when enabled workflows need message context. It uses Gmail compose to prepare draft replies for review.`

### Scene 6: Show explicit send approval

Time: `2:05 to 2:30`

On screen:

1. Stay on the reply approvals area if available.
2. Show that a draft exists and requires a user action before send.
3. If safe for the demo, approve one reply and show the send action.

Say:

`This is the Gmail send usage. ClawCloud does not bulk send or auto-send marketing messages. Gmail send is used only after the connected user explicitly approves or requests sending a reply.`

### Scene 7: Show calendar usage

Time: `2:30 to 2:55`

On screen:

1. Show a calendar-related answer, schedule view, reminder context, or a meeting briefing feature.
2. If you have a chat interface available, ask a schedule question such as `What is on my calendar today?`
3. Show the answer that comes from upcoming events.

Say:

`This is the Calendar readonly usage. ClawCloud reads the user's upcoming events from the primary Google Calendar so it can answer schedule questions, prepare reminders, and provide meeting context. It does not edit or create calendar events.`

### Scene 8: Show disconnect

Time: `2:55 to 3:15`

On screen:

1. Open `https://swift-deploy.in/settings`
2. Go to the Google Workspace row
3. Click `Disconnect` or show the disconnect control

Say:

`The user can revoke the integration at any time from settings. This demonstrates that access is user-controlled and revocable.`

### Scene 9: Closing

Time: `3:15 to 3:25`

Say:

`That completes the ClawCloud Gmail and Calendar OAuth scope demonstration for Google verification.`

## Shorter backup script

If you want a faster recording, say this while you perform the actions:

`This is ClawCloud. The app requests Gmail readonly, Gmail compose, Gmail send, and Calendar readonly. Gmail readonly is used to search and summarize the connected user's inbox. Gmail compose is used to prepare draft replies. Gmail send is used only after explicit user approval or request. Calendar readonly is used to answer schedule questions, prepare reminders, and provide meeting context from the user's primary Google Calendar. The user can disconnect the integration at any time from settings.`

## Reviewer-friendly checklist

Before uploading, confirm the video visibly shows:

- `https://swift-deploy.in/setup`
- the `Continue with Google` action
- the Google consent screen
- the granted Gmail and Calendar permissions
- return to ClawCloud after consent
- inbox assistance or reply draft behavior
- explicit send approval behavior if requesting `gmail.send`
- calendar usage
- the disconnect option in settings

## Upload steps

1. Upload the recording to YouTube.
2. Set visibility to `Unlisted`.
3. Copy the YouTube link.
4. Paste the link into Google Auth Platform -> Data access or Verification centre.

## Matching verification docs

Use this video together with:

- `GOOGLE-OAUTH-VERIFICATION-SUBMISSION.md`
- `GOOGLE-OAUTH-PUBLIC-LAUNCH.md`
