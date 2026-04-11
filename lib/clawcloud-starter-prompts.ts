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
    id: "whatsapp",
    label: "WhatsApp",
    description: "Send messages, summarize chats, inspect media, and run ClawCloud entirely from WhatsApp.",
    connectLabel: "Link WhatsApp to unlock messaging, reminders, media analysis, and chat memory commands.",
    taskTypes: [
      "custom_reminder",
      "user_contacts",
      "weekly_spend_summary",
    ],
    examples: [
      {
        label: "Send a message",
        prompt: 'Send "Running 10 minutes late" to Priya',
      },
      {
        label: "Read one chat",
        prompt: "Summarize the chat with Papa ji",
      },
      {
        label: "Read latest messages",
        prompt: "Ridhima ne mujhe kya message bheje hain?",
      },
      {
        label: "Reply professionally",
        prompt: 'Reply to Ridhima on WhatsApp saying "I will call tonight."',
      },
      {
        label: "Talk on my behalf",
        prompt: "Talk to Maa on my behalf",
      },
      {
        label: "Stop contact mode",
        prompt: "Stop talking to Maa",
      },
      {
        label: "Show contacts",
        prompt: "Show my WhatsApp contacts",
      },
      {
        label: "Sync contacts",
        prompt: "Sync WhatsApp contacts",
      },
      {
        label: "Save a contact",
        prompt: "Save contact: Priya = +919876543210",
      },
      {
        label: "Spanish chat summary",
        prompt: "Resume el chat con Ridhima",
      },
      {
        label: "Chinese send",
        prompt: "给爸爸发消息：我晚点到",
      },
      {
        label: "Inspect media",
        prompt: "Explain this image in detail",
      },
      {
        label: "Japanese history",
        prompt: "お父さんとのチャットを要約して",
      },
      {
        label: "Set reminder",
        prompt: "Remind me at 5pm to call Raj",
      },
    ],
  },
] as const;
