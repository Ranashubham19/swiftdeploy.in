import React from 'react';
import { Link } from 'react-router-dom';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';
import {
  buildBreadcrumbSchema,
  buildFaqSchema,
  buildOrganizationSchema,
  buildServiceSchema,
  buildWebPageSchema
} from '../utils/seo';

const useCases = [
  {
    title: 'Customer support bot',
    description: 'Deflect repetitive support questions, surface quick answers, and keep response times low in Telegram.'
  },
  {
    title: 'Lead capture bot',
    description: 'Collect names, company details, and intent signals before routing qualified leads to sales.'
  },
  {
    title: 'Operations assistant',
    description: 'Run reminders, internal requests, task updates, and business workflow triggers through a single Telegram bot.'
  }
];

const faqItems = [
  {
    question: 'How fast can I deploy a Telegram AI bot?',
    answer: 'SwiftDeploy is designed for quick setup, with a guided flow that helps you launch a Telegram AI bot in minutes instead of days.'
  },
  {
    question: 'Can I use the bot for customer support and lead generation?',
    answer: 'Yes. The strongest fit is handling support, lead qualification, and routine operations conversations inside Telegram.'
  },
  {
    question: 'Do I need to manage servers myself?',
    answer: 'The product is built around guided deployment so teams can launch faster without building a custom Telegram bot stack from scratch.'
  },
  {
    question: 'Can I choose different AI models?',
    answer: 'SwiftDeploy exposes model selection in the deployment flow so you can choose the assistant setup that matches your use case.'
  }
];

const TelegramAiBot: React.FC = () => {
  const title = 'Telegram AI Bot Platform for Support, Sales, and Ops | SwiftDeploy';
  const description =
    'Deploy a Telegram AI bot for customer support, lead capture, multilingual conversations, and business automation with SwiftDeploy.';

  const structuredData = [
    buildOrganizationSchema(),
    buildWebPageSchema({
      name: title,
      description,
      path: '/telegram-ai-bot'
    }),
    buildServiceSchema({
      name: 'Telegram AI bot deployment',
      description,
      path: '/telegram-ai-bot',
      serviceType: 'Telegram AI bot platform'
    }),
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Telegram AI Bot', path: '/telegram-ai-bot' }
    ]),
    buildFaqSchema(faqItems)
  ];

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/telegram-ai-bot"
        keywords="telegram ai bot, ai telegram bot, telegram customer support bot, telegram automation bot, telegram lead generation bot"
        structuredData={structuredData}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8 lg:p-10">
          <div className="inline-flex rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1 text-sm text-red-100">
            Telegram AI bot
          </div>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Deploy a Telegram AI bot for support, sales, and operations.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-zinc-300 md:text-lg">
            SwiftDeploy helps teams launch a Telegram AI bot without building the entire stack from scratch. Use it for
            customer support, lead capture, business automation, and multilingual conversations.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {['Customer support', 'Lead generation', 'Business automation', 'Multilingual replies'].map((label) => (
              <span key={label} className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300">
                {label}
              </span>
            ))}
          </div>
        </div>

        <aside className="rounded-[32px] border border-white/10 bg-[#090909] p-6">
          <p className="text-sm font-medium text-white">Main keyword cluster</p>
          <div className="mt-4 space-y-3 text-sm leading-7 text-zinc-400">
            <p>Telegram AI bot</p>
            <p>Telegram customer support bot</p>
            <p>Telegram automation bot</p>
            <p>Telegram lead generation bot</p>
          </div>
        </aside>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {useCases.map((item) => (
          <article key={item.title} className="rounded-[28px] border border-white/10 bg-[#090909] p-6">
            <p className="text-base font-medium text-white">{item.title}</p>
            <p className="mt-3 text-sm leading-7 text-zinc-400">{item.description}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-sm font-medium text-white">Why teams search for this</p>
          <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
            <p>Many teams do not want to stitch together hosting, webhooks, model selection, and bot setup by hand.</p>
            <p>They want a Telegram AI bot platform that gets the workflow live faster and still feels production-ready.</p>
            <p>SwiftDeploy is positioned around that exact need: faster launch, simpler deployment, and cleaner ongoing control.</p>
          </div>
        </article>

        <article className="rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-sm font-medium text-white">How deployment works</p>
          <div className="mt-5 space-y-3">
            {[
              'Pick your preferred AI model for the bot.',
              'Connect Telegram and provide the bot token in the guided flow.',
              'Verify the bot, launch it, and start using it for real conversations.'
            ].map((step, index) => (
              <div key={step} className="rounded-[24px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-7 text-zinc-300">
                <span className="mr-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500/12 text-xs text-red-100">
                  {index + 1}
                </span>
                {step}
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="mt-8 rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <p className="text-sm font-medium text-white">Common questions</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {faqItems.map((item) => (
            <article key={item.question} className="rounded-[24px] border border-white/8 bg-[#111114] p-5">
              <p className="text-base font-medium text-white">{item.question}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{item.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-center">
          <div>
            <p className="text-sm font-medium text-white">Related use cases</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Explore support, lead generation, and multilingual Telegram bot pages.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400">
              These narrower pages are useful for both buyers and search engines because they map directly to more specific
              use-case queries.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link to="/telegram-customer-support-bot" className="btn-deploy-gradient rounded-full px-5 py-3 text-center text-sm font-medium">
              Support bot page
            </Link>
            <Link to="/telegram-lead-generation-bot" className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Lead generation page
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
};

export default TelegramAiBot;
