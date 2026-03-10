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

const options = [
  {
    title: 'Generic chatbot builders',
    description: 'Useful for broad chatbot workflows, but not always optimized around Telegram-first deployment and business operations.'
  },
  {
    title: 'Custom development',
    description: 'Offers maximum flexibility, but comes with more engineering work, maintenance, and setup complexity.'
  },
  {
    title: 'SwiftDeploy',
    description: 'Built around faster Telegram AI bot deployment for support, lead capture, multilingual replies, and operations workflows.'
  }
];

const faqItems = [
  {
    question: 'What should I compare when choosing a Telegram bot platform?',
    answer:
      'Compare launch speed, maintenance load, pricing clarity, Telegram-specific workflow fit, and whether the product supports the use cases you care about most.'
  },
  {
    question: 'Why create a platform comparison page?',
    answer:
      'Comparison intent is valuable because people searching these terms are usually closer to a purchase or implementation decision than users reading generic informational content.'
  },
  {
    question: 'Where does SwiftDeploy fit best?',
    answer:
      'SwiftDeploy is strongest for teams that want a Telegram-first AI bot deployment path for support, lead generation, multilingual conversations, and operations.'
  }
];

const TelegramBotPlatformComparison: React.FC = () => {
  const title = 'Telegram Bot Platform Comparison for Support, Sales, and Automation';
  const description =
    'Compare Telegram bot platform options for support, sales, multilingual conversations, and business automation, including SwiftDeploy and custom build paths.';

  const structuredData = [
    buildOrganizationSchema(),
    buildWebPageSchema({
      name: title,
      description,
      path: '/telegram-bot-platform-comparison'
    }),
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Telegram Bot Platform Comparison', path: '/telegram-bot-platform-comparison' }
    ]),
    buildFaqSchema(faqItems)
  ];

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/telegram-bot-platform-comparison"
        keywords="telegram bot platform comparison, best telegram bot platform, telegram bot software comparison, telegram ai bot platform"
        structuredData={structuredData}
      />

      <section className="pt-8 text-center md:pt-12">
        <p className="text-sm text-red-400">Comparison</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
          Telegram bot platform comparison
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          Compare the main platform paths for support, sales, multilingual conversations, and business automation.
        </p>
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-3">
        {options.map((option) => (
          <article key={option.title} className="rounded-[28px] border border-white/10 bg-[#090909] p-6">
            <p className="text-base font-medium text-white">{option.title}</p>
            <p className="mt-3 text-sm leading-7 text-zinc-400">{option.description}</p>
          </article>
        ))}
      </section>

      <section className="mt-14 grid gap-6 md:grid-cols-2">
        <article className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-xl font-medium text-white">Decision lens</p>
          <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
            <p>Look at how fast you need to launch.</p>
            <p>Look at how much engineering maintenance you want to own after launch.</p>
            <p>Look at whether the product is optimized for Telegram-first workflows.</p>
            <p>Look at pricing clarity and whether you can start without a long implementation cycle.</p>
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-xl font-medium text-white">SwiftDeploy angle</p>
          <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
            <p>SwiftDeploy is not trying to be every chatbot builder for every channel.</p>
            <p>It is positioned around deploying Telegram AI bots for support, lead capture, multilingual conversations, and operations.</p>
            <p>That narrower focus is useful for teams that care more about fast Telegram deployment than broad no-code channel coverage.</p>
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
            <p className="text-xl font-medium text-white">Need a sharper comparison?</p>
            <p className="mt-4 text-sm leading-7 text-zinc-400">
              The custom development comparison page goes deeper on launch speed, maintenance, and the real build-vs-buy tradeoff.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link to="/swiftdeploy-vs-custom-telegram-bot-development" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Compare to custom build
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

export default TelegramBotPlatformComparison;
