import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { ICONS } from '../constants';

type WorkspaceNavKey = 'overview' | 'workers' | 'telegram' | 'discord' | 'pricing' | 'support';

interface WorkspaceShellProps {
  activeItem?: WorkspaceNavKey;
  badge?: string;
  title: string;
  description: string;
  user?: {
    name?: string;
    email?: string;
  } | null;
  rightActions?: React.ReactNode;
  children: React.ReactNode;
}

const navItems: Array<{
  key: WorkspaceNavKey;
  label: string;
  href: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'overview',
    label: 'Overview',
    href: '/',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 11l8-6 8 6" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 10v9h12v-9" />
      </svg>
    )
  },
  {
    key: 'workers',
    label: 'Workers',
    href: '/internet-worker',
    icon: <ICONS.Spark className="h-4 w-4" />
  },
  {
    key: 'telegram',
    label: 'Telegram',
    href: '/connect/telegram',
    icon: <ICONS.Telegram className="h-4 w-4" />
  },
  {
    key: 'discord',
    label: 'Discord',
    href: '/connect/discord',
    icon: <ICONS.Discord className="h-4 w-4" />
  },
  {
    key: 'pricing',
    label: 'Pricing',
    href: '/pricing',
    icon: <ICONS.Card className="h-4 w-4" />
  },
  {
    key: 'support',
    label: 'Support',
    href: '/contact',
    icon: <ICONS.Documentation className="h-4 w-4" />
  }
];

const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  activeItem = 'overview',
  badge,
  title,
  description,
  user,
  rightActions,
  children
}) => {
  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] gap-4 px-4 py-4 md:px-6 lg:px-8">
        <aside className="hidden lg:flex w-[252px] shrink-0 flex-col rounded-[28px] border border-white/10 bg-[#090909] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="border-b border-white/6 pb-5">
            <BrandLogo compact />
          </div>

          <div className="mt-6 space-y-1.5">
            {navItems.map((item) => {
              const isActive = item.key === activeItem;
              return (
                <Link
                  key={item.key}
                  to={item.href}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors ${
                    isActive
                      ? 'border-red-400/20 bg-red-500/12 text-red-100'
                      : 'border-transparent text-zinc-400 hover:border-white/8 hover:bg-white/[0.03] hover:text-zinc-100'
                  }`}
                >
                  <span className={isActive ? 'text-red-200' : 'text-zinc-500'}>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="mt-6 rounded-[24px] border border-white/8 bg-[#0d0d0f] p-4">
            <p className="text-xs font-medium text-zinc-500">Workspace</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Clean setup, fewer distractions, and one place to deploy or manage your bot.
            </p>
          </div>

          <div className="mt-auto rounded-[24px] border border-white/8 bg-[#0d0d0f] p-4">
            <p className="text-xs font-medium text-zinc-500">Signed in as</p>
            <p className="mt-2 text-sm font-medium text-white">{user?.name || 'SwiftDeploy user'}</p>
            <p className="mt-1 text-xs text-zinc-500">{user?.email || 'Secure session'}</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col rounded-[30px] border border-white/10 bg-[#090909] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <header className="border-b border-white/8 px-5 py-5 md:px-7 lg:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                {badge ? (
                  <div className="mb-3 inline-flex items-center rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-100">
                    {badge}
                  </div>
                ) : null}
                <h1 className="text-2xl font-semibold tracking-tight text-white md:text-[30px]">{title}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400 md:text-[15px]">{description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">{rightActions}</div>
            </div>

            <div className="mt-5 flex gap-2 overflow-x-auto lg:hidden">
              {navItems.map((item) => {
                const isActive = item.key === activeItem;
                return (
                  <Link
                    key={item.key}
                    to={item.href}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs ${
                      isActive
                        ? 'border-red-400/25 bg-red-500/12 text-red-100'
                        : 'border-white/8 bg-white/[0.02] text-zinc-400'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </header>

          <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceShell;
