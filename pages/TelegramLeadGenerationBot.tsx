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

const leadUseCases = [
  'Capture inbound leads from Telegram campaigns and communities.',
  'Ask qualification questions automatically before a salesperson joins.',
  'Collect company, budget, timeline, and intent details in a structured flow.',
  'Route high-intent leads to a human faster.'
];

const faqItems = [
  {
    question: 'What is a Telegram lead generation bot?',
    answer:
      'It is a Telegram bot designed to capture inbound leads, ask qualifying questions, and organize useful sales context before handoff.'
  },
  {
    question: 'Why use AI for Telegram lead capture?',
    answer:
      'AI helps keep the first conversation responsive, collects the same key details every time, and reduces manual qualification effort.'
  },
  {
    question: 'Can SwiftDeploy help launch this use case quickly?',
    answer:
      'Yes. SwiftDeploy is built around fast Telegram AI bot deployment so you can launch lead capture workflows with less setup overhead.'
  }
];

const TelegramLeadGenerationBot: React.FC = () => {
  const title = 'Telegram Lead Generation Bot for Sales Qualification | SwiftDeploy';
  const description =
    'Deploy a Telegram lead generation bot with SwiftDeploy to capture leads, ask qualification questions, and route high-intent prospects faster.';

  const structuredData = [
    buildOrganizationSchema(),
    buildWebPageSchema({
      name: title,
      description,
      path: '/telegram-lead-generation-bot'
    }),
    buildServiceSchema({
      name: 'Telegram lead generation bot deployment',
      description,
      path: '/telegram-lead-generation-bot',
      serviceType: 'Lead generation automation software'
    }),
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Telegram Lead Generation Bot', path: '/telegram-lead-generation-bot' }
    ]),
    buildFaqSchema(faqItems)
  ];

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/telegram-lead-generation-bot"
        keywords="telegram lead generation bot, telegram sales bot, lead capture bot for telegram, telegram lead qualification bot"
        structuredData={structuredData}
      />

      <section className="pt-8 text-center md:pt-12">
        <p className="text-sm text-red-400">Sales Qualification</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
          Deploy a Telegram lead generation bot that qualifies prospects
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          SwiftDeploy helps teams capture inbound demand, ask the right questions, and send more organized opportunities into the sales process.
        </p>
      </section>

      <section className="mt-14 grid gap-6 md:grid-cols-2">
        <article className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-xl font-medium text-white">What the bot does</p>
          <div className="mt-5 space-y-3">
            {leadUseCases.map((item) => (
              <div key={item} className="rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-7 text-zinc-300">
                {item}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-xl font-medium text-white">Why this page matters</p>
          <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
            <p>Many buyers search by use case, not product name.</p>
            <p>This page gives SwiftDeploy a focused URL around sales qualification instead of only generic AI bot terms.</p>
            <p>That improves relevance for narrower searches over time.</p>
          </div>
        </article>
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
            <p className="text-xl font-medium text-white">Related pages</p>
            <p className="mt-4 text-sm leading-7 text-zinc-400">
              Explore support and multilingual Telegram bot pages for other high-intent buyer searches.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link to="/telegram-customer-support-bot" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Support bot page
            </Link>
            <Link to="/multilingual-telegram-bot" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Multilingual bot
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
};

export default TelegramLeadGenerationBot;
