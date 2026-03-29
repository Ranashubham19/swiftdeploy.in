const WORKSPACE_KNOWLEDGE_PREFIX =
  /\b(explain|what is|what are|what does|what do|how does|how do|how can|how to|why does|why do|why is|why are|can i|should i|when should|difference between|different between|compare|versus|vs\.?|pros and cons|benefits of|meaning of|history of)\b/i;

const EMAIL_READ_REQUEST_PATTERN =
  /\b(search|find|look up|lookup|check|show|read|open|review|summari[sz]e|list|pull|fetch|get|give|tell|share|see|bring)\b.*\b(gmail|emails?|mails?|inbox|mailbox|mail)\b/i;

const EMAIL_MAILBOX_SLICE_PATTERN =
  /\b(top|latest|recent|newest|first|\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b.*\b(?:important|priority|unread|read)?\s*(?:gmail\s+)?(?:emails?|mails?|messages?)\b/i;

const EMAIL_CONTENTS_PATTERN =
  /\b(?:what\s+(?:do|does)|tell\s+me|show\s+me|read|summari[sz]e)\b.*\b(?:emails?|mails?|messages?|gmail|inbox|mailbox)\b.*\b(?:say|says|said)\b/i;

const CALENDAR_READ_REQUEST_PATTERN =
  /\b(show|check|look at|summari[sz]e|list|review|pull|give|tell|share|when|do i have|am i free)\b.*\b(calendar|schedule|agenda|meetings?|events?|appointments?|availability|free slot|free time)\b/i;

function normalizeWorkspaceQuestion(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasKnowledgePrefix(text: string) {
  return WORKSPACE_KNOWLEDGE_PREFIX.test(text);
}

export function looksLikeEmailWritingKnowledgeQuestion(text: string) {
  const normalized = normalizeWorkspaceQuestion(text);
  if (!hasKnowledgePrefix(normalized)) {
    return false;
  }

  return (
    /\b(email|mail|follow[- ]?up(?:\s+email)?)\b/.test(normalized)
    && /\b(write|draft|compose|send|reply|respond|subject|professional|formal|polite)\b/.test(normalized)
  );
}

export function looksLikeGmailKnowledgeQuestion(text: string) {
  const normalized = normalizeWorkspaceQuestion(text);
  if (!hasKnowledgePrefix(normalized)) {
    return false;
  }

  const hasMailboxKnowledgeSurface =
    /\b(gmail|inbox|mailbox|spam|junk|trash|archive|archiving|star(?:red)?|label|labels|promotions?|social|updates|forums|drafts?|signature|filter|filters|forward(?:ing)?|attachment|attachments|thread|threads)\b/.test(normalized)
    || (
      /\b(emails?|mails?|mail)\b/.test(normalized)
      && /\b(send|draft|reply|respond|archive|trash|delete|recover|restore|star|spam|junk|filter|signature|forward|attachment|attachments|inbox)\b/.test(normalized)
    );

  if (!hasMailboxKnowledgeSurface) {
    return false;
  }

  return !(
    EMAIL_READ_REQUEST_PATTERN.test(normalized)
    || EMAIL_MAILBOX_SLICE_PATTERN.test(normalized)
    || EMAIL_CONTENTS_PATTERN.test(normalized)
    || /\bwhat(?:'s| is)\s+in\s+my\s+(?:gmail|inbox|mailbox)\b/i.test(normalized)
  );
}

export function looksLikeCalendarKnowledgeQuestion(text: string) {
  const normalized = normalizeWorkspaceQuestion(text);
  if (!hasKnowledgePrefix(normalized)) {
    return false;
  }

  const hasCalendarSurface =
    /\b(google calendar|gcal|g calendar|calendar|meeting|meetings|event|events|appointment|appointments|schedule|agenda)\b/.test(normalized);

  if (!hasCalendarSurface) {
    return false;
  }

  return !(
    CALENDAR_READ_REQUEST_PATTERN.test(normalized)
    || /\b(today|tomorrow|tonight|this week|next week|upcoming|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*\b(calendar|schedule|agenda|meetings?|events?|appointments?)\b/.test(normalized)
    || /\bwhat(?:'s| is)\s+(?:on\s+)?(?:my\s+)?(calendar|schedule|agenda)\b/.test(normalized)
  );
}

export function looksLikeDriveKnowledgeQuestion(text: string) {
  const normalized = normalizeWorkspaceQuestion(text);
  return (
    hasKnowledgePrefix(normalized)
    && /\b(google drive|gdrive|g drive|google docs?|google sheets?|drive)\b/.test(normalized)
    && !(
      /\bwhat(?:'s| is)\s+in\b.*\b(?:my|the)\b.*\b(drive|folder|file|doc|sheet|spreadsheet)\b/.test(normalized)
      || /\b(?:contents?|details?)\s+of\b.*\b(?:my|the)\b.*\b(drive|folder|file|doc|sheet|spreadsheet)\b/.test(normalized)
      || (
        /\bmy\s+(?:drive|files?|folders?|docs?|documents?|sheets?|spreadsheets?)\b/.test(normalized)
        && /\b(read|open|show|find|search|look for|list|check|review|summari[sz]e)\b/.test(normalized)
      )
    )
  );
}

export function looksLikeWhatsAppSettingsKnowledgeQuestion(text: string) {
  const normalized = normalizeWorkspaceQuestion(text);
  if (!hasKnowledgePrefix(normalized)) {
    return false;
  }

  const hasSettingsSurface =
    (
      /\b(whatsapp|assistant)\b/.test(normalized)
      && /\b(settings|mode|reply tone|group replies|quiet hours|sensitive approval|direct send|first outreach|automation mode)\b/.test(normalized)
    )
    || /\b(settings|mode|reply tone|group replies|quiet hours|sensitive approval|direct send|first outreach|automation mode)\b.*\b(whatsapp|assistant)\b/.test(normalized);

  if (!hasSettingsSurface) {
    return false;
  }

  return !/\bmy\b/.test(normalized);
}
