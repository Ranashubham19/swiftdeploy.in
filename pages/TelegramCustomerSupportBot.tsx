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

const supportBenefits = [
  'Answer repetitive Telegram support questions instantly.',
  'Reduce response times without adding more human agents.',
  'Escalate edge cases after collecting useful customer context.',
  'Keep support active outside business hours.'
];

const faqItems = [
  {
    question: 'What is a Telegram customer support bot?',
    answer:
      'It is a Telegram bot that helps handle customer questions, automate first responses, gather details, and route issues to a human agent when needed.'
  },
  {
    question: 'Can SwiftDeploy help me deploy one quickly?',
    answer:
      'Yes. SwiftDeploy focuses on fast Telegram AI bot deployment so teams can launch support workflows without building a full custom stack.'
  },
  {
    question: 'Is this useful for small support teams?',
    answer:
      'Yes. Small teams benefit because the bot can handle repetitive questions and qualification steps before an agent takes over.'
  }
];

const TelegramCustomerSupportBot: React.FC = () => {
  const title = 'Telegram Customer Support Bot for Faster Replies | SwiftDeploy';
  const description =
    'Deploy a Telegram customer support bot with SwiftDeploy to answer common questions, reduce response times, and automate support workflows.';

  const structuredData = [
    buildOrganizationSchema(),
    buildWebPageSchema({
      name: title,
      description,
      path: '/telegram-customer-support-bot'
    }),
    buildServiceSchema({
      name: 'Telegram customer support bot deployment',
      description,
      path: '/telegram-customer-support-bot',
      serviceType: 'Customer support automation software'
    }),
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Telegram Customer Support Bot', path: '/telegram-customer-support-bot' }
    ]),
    buildFaqSchema(faqItems)
  ];

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/telegram-customer-support-bot"
        keywords="telegram customer support bot, telegram support bot, ai support bot for telegram, customer service telegram bot"
        structuredData={structuredData}
      />

      <section className="pt-8 text-center md:pt-12">
        <p className="text-sm text-red-400">Support Automation</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
          Deploy a Telegram customer support bot that answers faster
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          SwiftDeploy helps teams launch a Telegram support bot for FAQs, first-response coverage, and cleaner escalation workflows.
        </p>
      </section>

      <section className="mt-14 grid gap-6 md:grid-cols-2">
        <article className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-xl font-medium text-white">Why teams use it</p>
          <div className="mt-5 space-y-3">
            {supportBenefits.map((item) => (
              <div key={item} className="rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-7 text-zinc-300">
                {item}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-xl font-medium text-white">Typical fit</p>
          <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
            <p>E-commerce support on Telegram.</p>
            <p>SaaS onboarding and issue triage.</p>
            <p>Small teams that need 24/7 first-response coverage without more busywork.</p>
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
              Explore lead generation and multilingual Telegram bot pages for narrower use-case searches.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link to="/telegram-lead-generation-bot" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Lead generation bot
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

export default TelegramCustomerSupportBot;
