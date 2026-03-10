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

const languageBenefits = [
  'Reply to customers in multiple languages from one Telegram bot.',
  'Reduce delays caused by manual translation.',
  'Support international leads and support requests in the same workflow.',
  'Keep multilingual conversations structured and easier to manage.'
];

const faqItems = [
  {
    question: 'What is a multilingual Telegram bot?',
    answer:
      'It is a Telegram bot that can communicate with users in more than one language, making it useful for international support and sales conversations.'
  },
  {
    question: 'Why does this matter for business automation?',
    answer:
      'Many teams receive inbound messages from different regions. A multilingual Telegram bot helps them respond faster without building language-specific workflows.'
  },
  {
    question: 'Can SwiftDeploy support this use case?',
    answer:
      'Yes. SwiftDeploy is positioned as a Telegram AI bot platform with multilingual reply use cases built into its deployment flow.'
  }
];

const MultilingualTelegramBot: React.FC = () => {
  const title = 'Multilingual Telegram Bot for Global Customer Conversations | SwiftDeploy';
  const description =
    'Deploy a multilingual Telegram bot with SwiftDeploy to handle customer support, lead capture, and operations conversations across multiple languages.';

  const structuredData = [
    buildOrganizationSchema(),
    buildWebPageSchema({
      name: title,
      description,
      path: '/multilingual-telegram-bot'
    }),
    buildServiceSchema({
      name: 'Multilingual Telegram bot deployment',
      description,
      path: '/multilingual-telegram-bot',
      serviceType: 'Multilingual chatbot software'
    }),
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Multilingual Telegram Bot', path: '/multilingual-telegram-bot' }
    ]),
    buildFaqSchema(faqItems)
  ];

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/multilingual-telegram-bot"
        keywords="multilingual telegram bot, multi language telegram bot, telegram translation bot, global customer support bot"
        structuredData={structuredData}
      />

      <section className="pt-8 text-center md:pt-12">
        <p className="text-sm text-red-400">Multilingual AI Bot</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
          Deploy a multilingual Telegram bot for global customer conversations
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          SwiftDeploy helps teams handle support, lead capture, and operations conversations across multiple languages from one bot.
        </p>
      </section>

      <section className="mt-14 grid gap-6 md:grid-cols-2">
        <article className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-xl font-medium text-white">Why teams need this</p>
          <div className="mt-5 space-y-3">
            {languageBenefits.map((item) => (
              <div key={item} className="rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-7 text-zinc-300">
                {item}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-xl font-medium text-white">Search value</p>
          <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
            <p>Multilingual bot searches are narrower but highly specific.</p>
            <p>Dedicated copy for this use case gives SwiftDeploy a better chance to rank for that long-tail intent.</p>
            <p>It also strengthens the broader Telegram AI bot topic cluster across the site.</p>
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
              Explore support and lead generation Telegram bot pages to cover the rest of the buyer journey.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link to="/telegram-customer-support-bot" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Support bot page
            </Link>
            <Link to="/telegram-lead-generation-bot" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Lead generation bot
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
};

export default MultilingualTelegramBot;
