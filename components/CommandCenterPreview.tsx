import React from 'react';
import { ICONS } from '../constants';

interface CommandCenterPreviewProps {
  botName?: string;
  botUsername?: string;
  creditUsd?: number;
  className?: string;
}

const commandThreads = [
  { name: 'Orchestrator', role: 'Main agent', preview: 'Schedules work and routes requests.', tone: 'bg-red-500/15 text-red-100' },
  { name: 'Support', role: 'Replies', preview: 'Handles customer questions and summaries.', tone: 'bg-white/8 text-zinc-100' },
  { name: 'Leads', role: 'Capture', preview: 'Collects intent and sends handoff notes.', tone: 'bg-white/8 text-zinc-100' },
  { name: 'Memory', role: 'Context', preview: 'Stores recent context for better follow-ups.', tone: 'bg-white/8 text-zinc-100' }
];

const previewMessages = [
  {
    author: 'Orchestrator',
    text: 'Bot is online. Support, lead capture, and credit alerts are ready.',
    align: 'left'
  },
  {
    author: 'Operator',
    text: 'Keep replies short and escalate paid leads to sales.',
    align: 'right'
  },
  {
    author: 'Support',
    text: 'Understood. High-intent leads will be flagged with context.',
    align: 'left'
  }
];

const CommandCenterPreview: React.FC<CommandCenterPreviewProps> = ({
  botName = 'SwiftDeploy Bot',
  botUsername = 'swiftdeploy_bot',
  creditUsd = 10,
  className = ''
}) => {
  return (
    <div className={`overflow-hidden rounded-[30px] border border-white/10 bg-[#070707] shadow-[0_40px_100px_rgba(0,0,0,0.4)] ${className}`}>
      <div className="grid min-h-[560px] lg:grid-cols-[220px_290px_minmax(0,1fr)] xl:grid-cols-[220px_290px_minmax(0,1fr)_300px]">
        <aside className="hidden border-r border-white/8 bg-[#0b0b0c] p-4 lg:flex lg:flex-col">
          <div className="flex items-center gap-3 border-b border-white/6 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/12">
              <ICONS.LogoMark className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">SwiftDeploy</p>
              <p className="text-xs text-zinc-500">Command center</p>
            </div>
          </div>

          <div className="mt-5 space-y-1.5 text-sm">
            {[
              { label: 'Overview', icon: <ICONS.Bots className="h-4 w-4" /> },
              {
                label: 'Messages',
                icon: (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5h14a2 2 0 0 1 2 2v14l-4-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
                  </svg>
                )
              },
              { label: 'Billing', icon: <ICONS.Card className="h-4 w-4" /> },
              { label: 'Settings', icon: <ICONS.Settings className="h-4 w-4" /> }
            ].map((item, index) => {
              const active = item.label === 'Messages';
              return (
                <div
                  key={item.label}
                  className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${
                    active
                      ? 'border-red-400/20 bg-red-500/12 text-red-100'
                      : 'border-transparent text-zinc-400'
                  }`}
                >
                  <span className={index === 0 ? 'text-zinc-500' : active ? 'text-red-200' : 'text-zinc-500'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-auto rounded-[22px] border border-white/8 bg-[#111114] p-4">
            <p className="text-xs text-zinc-500">Current bot</p>
            <p className="mt-2 text-sm font-medium text-white">{botName}</p>
            <p className="mt-1 text-xs text-zinc-500">@{botUsername}</p>
          </div>
        </aside>

        <section className="border-b border-white/8 p-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Messages</p>
              <p className="text-xs text-zinc-500">Simple queue for your agents</p>
            </div>
            <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-400">
              4 agents
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {commandThreads.map((thread) => (
              <div key={thread.name} className="rounded-[22px] border border-white/8 bg-[#101012] p-3">
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${thread.tone}`}>
                    {thread.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{thread.name}</p>
                      <span className="text-xs text-zinc-500">{thread.role}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-400">{thread.preview}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-white">{botName}</p>
              <p className="text-xs text-zinc-500">Live conversation workspace</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-100">
                Online
              </span>
              <button className="flex h-9 w-9 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] text-zinc-400">
                <ICONS.Settings className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-4 p-4">
            {previewMessages.map((message, index) => (
              <div
                key={`${message.author}-${index}`}
                className={`flex ${message.align === 'right' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[420px] rounded-[22px] px-4 py-3 text-sm leading-6 ${
                    message.align === 'right'
                      ? 'bg-red-500/85 text-white'
                      : 'border border-white/8 bg-[#111114] text-zinc-200'
                  }`}
                >
                  <p className={`mb-1 text-xs ${message.align === 'right' ? 'text-red-100/80' : 'text-zinc-500'}`}>
                    {message.author}
                  </p>
                  <p>{message.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-white/8 p-4">
            <div className="flex items-center gap-3 rounded-[22px] border border-white/8 bg-[#111114] px-4 py-3">
              <svg className="h-4 w-4 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
              <span className="text-sm text-zinc-500">Message {botName}...</span>
              <button className="ml-auto rounded-full bg-red-500 px-4 py-2 text-xs font-medium text-white">Send</button>
            </div>
          </div>
        </section>

        <aside className="hidden border-l border-white/8 bg-[#0b0b0c] p-4 xl:flex xl:flex-col">
          <p className="text-sm font-medium text-white">Status</p>
          <div className="mt-4 grid gap-3">
            <div className="rounded-[22px] border border-white/8 bg-[#111114] p-4">
              <p className="text-xs text-zinc-500">Credits</p>
              <p className="mt-2 text-3xl font-semibold text-white">${creditUsd}</p>
              <p className="mt-1 text-xs text-zinc-500">Ready for the next conversations</p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-[#111114] p-4">
              <p className="text-xs text-zinc-500">Default model</p>
              <p className="mt-2 text-sm font-medium text-white">GPT-5.2</p>
              <p className="mt-1 text-xs text-zinc-500">Balanced for customer support and sales flows</p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-[#111114] p-4">
              <p className="text-xs text-zinc-500">Shortcuts</p>
              <div className="mt-3 space-y-2 text-sm text-zinc-300">
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2">Open Telegram</div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2">Top up credits</div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2">Contact support</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default CommandCenterPreview;
