import type { ClawCloudTaskType } from "@/lib/clawcloud-types";

export type ClawCloudStarterPromptSectionId = "gmail" | "calendar" | "drive" | "whatsapp";

export type ClawCloudStarterPromptExample = {
  label: string;
  prompt: string;
};

export type ClawCloudStarterPromptSection = {
  id: ClawCloudStarterPromptSectionId;
  label: string;
  description: string;
  connectLabel: string;
  taskTypes?: readonly ClawCloudTaskType[];
  examples: readonly ClawCloudStarterPromptExample[];
};

export const clawCloudStarterPromptSections: readonly ClawCloudStarterPromptSection[] = [
  {
    id: "gmail",
    label: "Gmail",
    description: "Search, summarise, and draft from your inbox without leaving ClawCloud.",
    connectLabel: "Connect Gmail to unlock inbox search, summaries, and draft-writing prompts.",
    taskTypes: ["morning_briefing", "draft_replies", "email_search", "evening_summary"],
    examples: [
      {
        label: "Unread summary",
        prompt: "Summarise unread emails from today",
      },
      {
        label: "Find Raj email",
        prompt: "Search my inbox for emails from Raj about the contract",
      },
      {
        label: "Create draft",
        prompt: "Create a Gmail draft to my Gmail saying I understood the update and will follow up tomorrow",
      },
      {
        label: "Reply draft",
        prompt: "Draft a reply to my latest email from Priya saying I understand your message and will follow up tomorrow",
      },
      {
        label: "Archive latest",
        prompt: "Archive my latest email from Google",
      },
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Ask about meetings, free slots, and your upcoming schedule in plain English.",
    connectLabel: "Connect Google Calendar to unlock meeting, schedule, and availability prompts.",
    taskTypes: ["meeting_reminders", "evening_summary"],
    examples: [
      {
        label: "Tomorrow's meetings",
        prompt: "What meetings do I have tomorrow?",
      },
      {
        label: "Free slots",
        prompt: "Do I have any free slots today?",
      },
      {
        label: "This week",
        prompt: "Show my calendar this week",
      },
      {
        label: "Create meeting",
        prompt: "Create a calendar event called Project Sync tomorrow at 4pm for 45 minutes",
      },
    ],
  },
  {
    id: "drive",
    label: "Drive",
    description: "Find files fast and ask ClawCloud to pull the important details out for you.",
    connectLabel: "Connect Google Drive to unlock file search and document questions.",
    taskTypes: [],
    examples: [
      {
        label: "Recent files",
        prompt: "List my recent Drive files",
      },
      {
        label: "Budget sheet",
        prompt: "Find the Q4 budget sheet in Drive",
      },
      {
        label: "Project plan",
        prompt: "What's in my project plan doc?",
      },
      {
        label: "Folder details",
        prompt: "What is in my Finance folder in Drive?",
      },
    ],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "Send messages, set reminders, and manage approvals directly from your chat.",
    connectLabel: "Link WhatsApp to unlock chat actions, reminders, and approval commands.",
    taskTypes: [
      "morning_briefing",
      "draft_replies",
      "meeting_reminders",
      "email_search",
      "evening_summary",
      "custom_reminder",
      "weekly_spend",
    ],
    examples: [
      {
        label: "Send an update",
        prompt: 'Send "Running 10 minutes late" to Priya',
      },
      {
        label: "Set reminder",
        prompt: "Remind me at 5pm to call Raj",
      },
      {
        label: "Pending approvals",
        prompt: "Show my pending WhatsApp approvals",
      },
      {
        label: "Assistant settings",
        prompt: "Show my WhatsApp settings",
      },
    ],
  },
] as const;
