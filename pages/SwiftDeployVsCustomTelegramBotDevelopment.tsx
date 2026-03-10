import React from 'react';
import { Link } from 'react-router-dom';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';
import {
  buildBreadcrumbSchema,
  buildFaqSchema,
  buildOrganizationSchema,
  buildWebPageSchema
} from '../utils/seo';

const comparisonRows = [
  {
    category: 'Time to launch',
    swiftdeploy: 'Guided deployment flow for faster launch',
    custom: 'Longer setup across hosting, webhooks, bot logic, billing, and maintenance'
  },
  {
    category: 'Maintenance load',
    swiftdeploy: 'Platform-oriented path with productized setup',
    custom: 'You own infrastructure, updates, debugging, and operational drift'
  },
  {
    category: 'Best fit',
    swiftdeploy: 'Teams that want to launch Telegram AI bots quickly',
    custom: 'Teams that need highly bespoke architecture and can absorb engineering overhead'
  },
  {
    category: 'Commercial clarity',
    swiftdeploy: 'Public pricing and guided onboarding path',
    custom: 'Cost depends on engineering time, hosting, support, and iteration'
  }
];

const faqItems = [
  {
    question: 'When is SwiftDeploy better than a custom Telegram bot build?',
    answer:
      'SwiftDeploy is usually the stronger fit when you want to launch faster, reduce operational setup, and get to a working Telegram AI bot without building the whole system yourself.'
  },
  {
    question: 'When is a custom build still the right choice?',
    answer:
      'A custom build is more suitable when you need a highly bespoke architecture, unusual integrations, or product behavior that does not map well to a deployment platform.'
  },
  {
    question: 'Does this page target a comparison keyword?',
    answer:
      'Yes. It is designed to target comparison intent around custom Telegram bot development versus a faster platform approach.'
  }
];

const SwiftDeployVsCustomTelegramBotDevelopment: React.FC = () => {
  const title = 'SwiftDeploy vs Custom Telegram Bot Development | Comparison Guide';
  const description =
    'Compare SwiftDeploy with custom Telegram bot development for launch speed, maintenance, pricing clarity, and best-fit use cases.';

  const structuredData = [
    buildOrganizationSchema(),
    buildWebPageSchema({
      name: title,
      description,
      path: '/swiftdeploy-vs-custom-telegram-bot-development'
    }),
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'SwiftDeploy vs Custom Telegram Bot Development', path: '/swiftdeploy-vs-custom-telegram-bot-development' }
    ]),
    buildFaqSchema(faqItems)
  ];

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/swiftdeploy-vs-custom-telegram-bot-development"
        keywords="swiftdeploy vs custom telegram bot development, custom telegram bot development comparison, telegram bot platform vs custom build"
        structuredData={structuredData}
      />

      <section className="pt-8 text-center md:pt-12">
        <p className="text-sm text-red-400">Comparison</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
          SwiftDeploy vs custom Telegram bot development
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          Compare the platform path with a custom build across launch speed, maintenance, pricing clarity, and team fit.
        </p>
      </section>

      <section className="mt-14 rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <p className="text-xl font-medium text-white">Side-by-side view</p>
        <div className="mt-5 space-y-4">
          {comparisonRows.map((row) => (
            <div key={row.category} className="grid gap-4 rounded-[22px] border border-white/8 bg-[#111114] p-5 md:grid-cols-[0.25fr_0.375fr_0.375fr]">
              <p className="text-base font-medium text-white">{row.category}</p>
              <div>
                <p className="text-sm font-medium text-white">SwiftDeploy</p>
                <p className="mt-2 text-sm leading-6 text-zinc-300">{row.swiftdeploy}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Custom build</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{row.custom}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14 rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <p className="text-xl font-medium text-white">Common questions</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {faqItems.map((item) => (
            <article key={item.question} className="rounded-[22px] border border-white/8 bg-[#111114] p-5">
              <p className="text-base font-medium text-white">{item.question}</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{item.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-14 rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <div className="grid gap-6 md:grid-cols-[1fr_300px] md:items-center">
          <div>
            <p className="text-xl font-medium text-white">Next comparison</p>
            <p className="mt-4 text-sm leading-7 text-zinc-400">
              If you want a broader category view, the platform comparison page compares generic builders, custom development, and SwiftDeploy.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link to="/telegram-bot-platform-comparison" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Platform comparison
            </Link>
            <Link to="/pricing" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              View pricing
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
};

export default SwiftDeployVsCustomTelegramBotDevelopment;
