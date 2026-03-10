import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Platform } from '../types';
import { ICONS } from '../constants';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';
import { apiUrl } from '../utils/api';
import {
  buildFaqSchema,
  buildOfferSchema,
  buildOrganizationSchema,
  buildServiceSchema,
  buildSoftwareApplicationSchema,
  buildWebPageSchema
} from '../utils/seo';

const modelOptions = [
  {
    id: 'claude-opus-4.5',
    label: 'Claude Opus 4.5',
    icon: <ICONS.Claude className="h-5 w-5" />
  },
  {
    id: 'gpt-5.2',
    label: 'GPT-5.2',
    icon: <ICONS.GPTSpark className="h-5 w-5" />
  },
  {
    id: 'gemini-3-flash',
    label: 'Gemini 3 Flash',
    icon: <ICONS.Gemini className="h-5 w-5" />
  }
];

const useCaseTags = [
  'Amazon price tracking',
  'Remote job monitoring',
  'AI news digests',
  'Webpage change alerts',
  'Competitor price watch',
  'Product availability checks',
  'Daily lead research',
  'Marketplace monitoring',
  'Email and Telegram alerts',
  'Scheduled web tasks'
];

const comparisonRows = [
  ['Write or source a custom scraping workflow', '12 min'],
  ['Map selectors and extraction rules', '9 min'],
  ['Set schedules, retries, and result storage', '8 min'],
  ['Connect alert delivery and execution logs', '6 min'],
  ['Repair broken selectors after layout changes', '10 min']
];

const workerCards = [
  {
    eyebrow: 'Natural language',
    title: 'Describe the outcome once',
    description: 'Write the task in plain English, like tracking MacBook prices, finding remote jobs, or watching a webpage for changes.'
  },
  {
    eyebrow: 'Automation engine',
    title: 'SwiftDeploy prepares the worker',
    description: 'SwiftDeploy turns that request into site actions, extraction rules, schedules, and delivery logic without manual scripting.'
  },
  {
    eyebrow: 'Self-repair',
    title: 'The worker repairs broken steps',
    description: 'If a selector breaks, the worker scans the page, finds a valid replacement, updates the step, and retries automatically.'
  }
];

const workerFlow = [
  {
    title: 'Task prompt',
    body: 'Track iPhone prices on Amazon every hour and alert me on Telegram if they drop.'
  },
  {
    title: 'Structured run plan',
    body: 'Website, actions, extraction target, schedule, and notification rule are converted into a reusable automation flow.'
  },
  {
    title: 'Scheduled result delivery',
    body: 'The worker runs in the background, stores results, logs each execution, and sends updates through Telegram or email.'
  }
];

const LandingPage: React.FC<{ user: User | null; onLogout: () => void }> = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState<string>('claude-opus-4.5');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const title = 'SwiftDeploy | OpenClaw deployment and AI internet workers';
  const description =
    'Launch OpenClaw and recurring AI internet workers for price tracking, website monitoring, job discovery, alerts, and scheduled web automation from one platform.';

  const faqItems = [
    {
      question: 'What is SwiftDeploy?',
      answer: 'SwiftDeploy is a deployment platform for OpenClaw and recurring AI internet workers that monitor websites, collect data, and send alerts automatically.'
    },
    {
      question: 'How much does SwiftDeploy cost?',
      answer: 'SwiftDeploy Pro is currently shown at $39/month, with custom credit top-ups that start at $10.'
    },
    {
      question: 'Who should use SwiftDeploy?',
      answer: 'It fits teams that want one platform for OpenClaw deployment, AI workers for price tracking or job monitoring, and recurring web automation without building the stack from scratch.'
    }
  ];

  const structuredData = [
    buildOrganizationSchema(),
    buildWebPageSchema({
      name: title,
      description,
      path: '/'
    }),
    buildServiceSchema({
      name: 'SwiftDeploy platform for OpenClaw and AI internet workers',
      description,
      path: '/',
      serviceType: 'OpenClaw deployment and AI worker automation platform'
    }),
    buildSoftwareApplicationSchema({
      name: 'SwiftDeploy',
      description,
      path: '/',
      applicationCategory: 'BusinessApplication',
      offers: [
        buildOfferSchema({
          name: 'SwiftDeploy Pro',
          price: 39,
          path: '/pricing',
          category: 'subscription',
          description: 'Monthly subscription for OpenClaw and AI internet worker deployment.'
        })
      ]
    }),
    buildFaqSchema(faqItems)
  ];

  const handleDeploymentInit = () => {
    navigate('/connect/telegram', { state: { model: selectedModel } });
  };

  const handleGoogleAuthStart = () => {
    navigate('/login?mode=register&redirectTo=/connect/telegram', {
      state: { redirectTo: '/connect/telegram' }
    });
  };

  const accountName = user?.name?.trim() || user?.email?.split('@')[0] || 'Google account';
  const accountInitial = accountName.slice(0, 1).toUpperCase() || 'S';

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await fetch(apiUrl('/logout'), {
        method: 'GET',
        credentials: 'include'
      });
    } catch {
      // Local session state is cleared either way.
    } finally {
      onLogout();
      setIsSigningOut(false);
      navigate('/', { replace: true });
    }
  };

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/"
        keywords="ai internet worker, website monitoring automation, price tracking automation, remote job alerts, AI web automation"
        structuredData={structuredData}
      />

      <section className="pt-6 text-center md:pt-8">
        <h1 className="mx-auto max-w-[1260px] text-[40px] font-[400] tracking-[-0.03em] text-zinc-100 md:text-[60px] md:leading-[1.08]">
          Deploy OpenClaw under 30 seconds
        </h1>
        <p className="mx-auto mt-5 max-w-[900px] text-[17px] leading-8 text-zinc-400 md:text-lg">
          Launch OpenClaw fast, then add AI internet workers for price tracking, website monitoring, job discovery,
          and alerts
          <span className="block">from the same guided deployment platform.</span>
        </p>
      </section>

      <section className="mx-auto mt-8 max-w-[820px] rounded-[30px] border border-white/10 bg-[#070707] p-6 shadow-[0_25px_80px_rgba(0,0,0,0.45)] md:p-10">
        <div className="space-y-10 text-left">
          <div>
            <p className="text-[18px] font-semibold text-white">Which model should power your workflow?</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {modelOptions.map((model) => {
                const active = selectedModel === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModel(model.id)}
                    className={`option-chip inline-flex items-center gap-3 rounded-2xl border px-5 py-3 text-sm font-semibold tracking-[-0.01em] transition-colors ${
                      active
                        ? 'option-chip-active border-white/30 bg-white/[0.06] text-white'
                        : 'border-white/10 bg-white/[0.02] text-zinc-200 hover:border-white/20'
                    }`}
                  >
                    {model.icon}
                    {model.label}
                    {active ? <ICONS.Check className="h-4 w-4 text-zinc-200" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[18px] font-semibold text-white">Which channel should receive your alerts?</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {[
                {
                  platform: Platform.TELEGRAM,
                  label: 'Telegram',
                  enabled: true,
                  icon: <ICONS.Telegram className="h-5 w-5" />
                },
                {
                  platform: Platform.DISCORD,
                  label: 'Discord',
                  enabled: false,
                  icon: <ICONS.Discord className="h-5 w-5" />
                },
                {
                  platform: Platform.WHATSAPP,
                  label: 'WhatsApp',
                  enabled: false,
                  icon: <ICONS.WhatsApp className="h-5 w-5" />
                }
              ].map((item) => {
                const active = selectedPlatform === item.platform;
                return (
                  <button
                    key={item.label}
                    type="button"
                    disabled={!item.enabled}
                    onClick={() => item.enabled && setSelectedPlatform(item.platform)}
                    className={`option-chip inline-flex items-center gap-3 rounded-2xl border px-5 py-3 text-sm font-semibold tracking-[-0.01em] transition-colors ${
                      active
                        ? 'option-chip-active border-white/30 bg-white/[0.06] text-white'
                        : 'border-white/10 bg-white/[0.02] text-zinc-200'
                    } ${item.enabled ? 'hover:border-white/20' : 'option-chip-disabled cursor-not-allowed'}`}
                  >
                    {item.icon}
                    {item.label}
                    {!item.enabled ? <span className="text-xs text-zinc-600">Coming soon</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          {user ? (
            <>
              <div className="flex items-center gap-4">
                <div className="flex h-[2.85rem] w-[2.85rem] shrink-0 items-center justify-center rounded-[14px] bg-[#0f67b5] text-[1.28rem] font-medium text-white shadow-[0_8px_20px_rgba(15,103,181,0.18)]">
                  {accountInitial}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <p className="truncate text-[18px] font-semibold tracking-[-0.02em] text-white md:text-[19px]">{accountName}</p>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      disabled={isSigningOut}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label="Sign out"
                      title="Sign out"
                    >
                      <ICONS.LogOut className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                  <p className="truncate text-[15px] text-zinc-400 md:text-[16px]">{user.email}</p>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={handleDeploymentInit}
                  className="inline-flex min-w-[250px] items-center justify-center gap-3 rounded-2xl bg-[#6f6f76] px-6 py-4 text-lg font-medium text-black transition-colors hover:bg-[#85858c]"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 3v7h8l-10 11v-7H3l10-11Z" />
                  </svg>
                  Deploy OpenClaw
                </button>
                <p className="mt-4 text-sm text-zinc-400">
                  Telegram setup opens immediately after you click Deploy OpenClaw.{` `}
                  <span className="text-[#818cf8]">AI internet worker tools open after sign-in.</span>
                </p>
              </div>
            </>
          ) : (
            <div>
              <button
                type="button"
                onClick={handleGoogleAuthStart}
                className="inline-flex min-w-[240px] items-center justify-center gap-3 rounded-[18px] border border-black/20 bg-[#f4f4f5] px-5 py-3.5 text-[17px] font-medium text-[#111111] shadow-[0_14px_30px_rgba(0,0,0,0.28)] transition-colors hover:bg-white"
              >
                <ICONS.Google className="h-5 w-5 shrink-0" />
                <span>Sign in with Google</span>
              </button>
              <p className="mt-4 text-sm text-zinc-500">
                Sign in to deploy OpenClaw, connect channels, and open the AI internet worker dashboard.{` `}
                <span className="text-[#818cf8]">Limited cloud servers - only 11 left.</span>
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto mt-16 grid gap-4 md:grid-cols-3">
        {workerCards.map((card) => (
          <article key={card.title} className="rounded-[28px] border border-white/10 bg-[#090909] p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-red-300">{card.eyebrow}</p>
            <h2 className="mt-4 text-2xl font-medium tracking-[-0.03em] text-white">{card.title}</h2>
            <p className="mt-4 text-sm leading-7 text-zinc-400">{card.description}</p>
          </article>
        ))}
      </section>

      <section className="mx-auto mt-8 rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <div className="grid gap-4 md:grid-cols-3">
          {workerFlow.map((step, index) => (
            <div key={step.title} className="rounded-[24px] border border-white/8 bg-[#111114] p-5">
              <p className="text-sm text-zinc-500">0{index + 1}</p>
              <p className="mt-3 text-lg font-medium text-white">{step.title}</p>
              <p className="mt-3 text-sm leading-7 text-zinc-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-28 max-w-[980px]">
        <div className="text-center">
          <div className="inline-flex items-center gap-4 text-sm text-red-400">
            <span className="h-px w-24 bg-red-500/30" />
            Comparison
            <span className="h-px w-24 bg-red-500/30" />
          </div>
          <h2 className="mx-auto mt-6 max-w-[980px] text-[38px] font-[400] tracking-[-0.03em] text-zinc-100 md:text-[58px] md:leading-[1.08]">
            Build internet automation yourself vs SwiftDeploy
          </h2>
        </div>

        <div className="mt-14 grid gap-10 border-white/10 md:grid-cols-[1fr_auto_0.78fr] md:items-start">
          <div className="space-y-4">
            <p className="text-3xl italic text-zinc-300">Traditional</p>
            <div className="space-y-4 border-b border-white/10 pb-6">
              {comparisonRows.map(([label, time]) => (
                <div key={label} className="flex items-start justify-between gap-6 text-lg text-zinc-400">
                  <span>{label}</span>
                  <span className="whitespace-nowrap text-zinc-300">{time}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-2xl font-semibold text-white">
              <span>Total</span>
              <span>40+ min</span>
            </div>
            <p className="text-lg italic leading-10 text-zinc-400">
              If you&apos;re{' '}
              <span className="rounded-md bg-[#a61f2d]/18 px-2 py-1 text-[#ff5c6f] not-italic">non-technical</span>
              , multiply these{' '}
              <span className="rounded-md bg-[#a61f2d]/18 px-2 py-1 text-[#ff5c6f] not-italic">times by 10</span>
              {' '}because you have to learn each step before doing.
            </p>
          </div>

          <div className="hidden h-full w-px bg-white/10 md:block" />

          <div>
            <p className="text-3xl italic text-zinc-300">SwiftDeploy</p>
            <p className="mt-6 text-5xl font-[400] tracking-[-0.02em] text-white">&lt;30 sec</p>
            <p className="mt-4 text-xl leading-9 text-zinc-300">
              Deploy OpenClaw, describe the task, and launch your worker in under 30 seconds.
            </p>
            <p className="mt-6 text-lg leading-9 text-zinc-400">
              Browser execution, scheduling, results, notifications, and repair logic are prepared in one guided flow, so you can move from idea to live automation without assembling the infrastructure yourself.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-28 max-w-[980px] text-center">
        <h2 className="mx-auto max-w-[980px] text-[38px] font-[400] tracking-[-0.03em] text-zinc-100 md:text-[58px] md:leading-[1.08]">
          What can SwiftDeploy automate for you?
        </h2>
        <p className="mx-auto mt-4 max-w-[900px] text-[22px] font-[400] tracking-[-0.02em] text-zinc-500 md:text-[34px]">
          OpenClaw for conversations, internet workers for recurring web tasks
        </p>

        <div className="mt-14 flex flex-wrap justify-center gap-3">
          {useCaseTags.map((tag) => (
            <div
              key={tag}
              className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-3 text-lg text-zinc-300 shadow-[0_10px_22px_rgba(0,0,0,0.22)]"
            >
              {tag}
            </div>
          ))}
        </div>

        <p className="mt-12 text-lg italic text-zinc-400">
          Add new internet workflows as your team grows, without rebuilding the automation layer each time.
        </p>

        <div className="mt-8 flex justify-center">
          <Link
            to={user ? '/internet-worker' : '/login?redirectTo=/internet-worker'}
            className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-medium text-white transition-colors hover:border-white/20 hover:bg-white/[0.05]"
          >
            Open AI internet worker dashboard
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
};

export default LandingPage;
