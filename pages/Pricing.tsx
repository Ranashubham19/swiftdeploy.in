import React from 'react';
import { Link } from 'react-router-dom';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';
import {
  buildBreadcrumbSchema,
  buildFaqSchema,
  buildOfferSchema,
  buildOrganizationSchema,
  buildSoftwareApplicationSchema,
  buildWebPageSchema
} from '../utils/seo';

const pricingFaq = [
  {
    question: 'How much does SwiftDeploy Pro cost?',
    answer: 'SwiftDeploy Pro is currently listed in the in-product setup flow at $39 per month.'
  },
  {
    question: 'Are there separate bot credits?',
    answer: 'Yes. The product flow also exposes credit top-ups in $10, $25, $50, and $100 packs for bot balance management.'
  },
  {
    question: 'Is there a higher-volume option?',
    answer: 'Yes. If you need a larger rollout or priority support, contact SwiftDeploy about Pro Fleet or custom onboarding.'
  },
  {
    question: 'Do I need to contact sales before starting?',
    answer: 'No. You can start with the standard guided flow and contact the team if you need a larger plan.'
  }
];

const offers = [
  buildOfferSchema({
    name: 'SwiftDeploy Pro',
    price: 39,
    path: '/pricing',
    category: 'subscription',
    description: 'Monthly subscription for first-time AI bot setup and ongoing access.'
  }),
  buildOfferSchema({
    name: 'Bot Credit Pack $10',
    price: 10,
    path: '/pricing',
    category: 'credit-pack',
    description: 'Recharge pack for bot credits.'
  }),
  buildOfferSchema({
    name: 'Bot Credit Pack $25',
    price: 25,
    path: '/pricing',
    category: 'credit-pack',
    description: 'Recharge pack for bot credits.'
  }),
  buildOfferSchema({
    name: 'Bot Credit Pack $50',
    price: 50,
    path: '/pricing',
    category: 'credit-pack',
    description: 'Recharge pack for bot credits.'
  }),
  buildOfferSchema({
    name: 'Bot Credit Pack $100',
    price: 100,
    path: '/pricing',
    category: 'credit-pack',
    description: 'Recharge pack for bot credits.'
  })
];

const Pricing: React.FC = () => {
  const title = 'SwiftDeploy Pricing for AI Telegram Bots | Pro Plan and Credit Packs';
  const description =
    'See SwiftDeploy pricing for AI Telegram bots, including the Pro plan at $39/month and credit top-up packs for bot usage.';

  const structuredData = [
    buildOrganizationSchema(),
    buildWebPageSchema({
      name: title,
      description,
      path: '/pricing'
    }),
    buildSoftwareApplicationSchema({
      name: 'SwiftDeploy',
      description,
      path: '/pricing',
      applicationCategory: 'BusinessApplication',
      offers
    }),
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Pricing', path: '/pricing' }
    ]),
    buildFaqSchema(pricingFaq)
  ];

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/pricing"
        keywords="swiftdeploy pricing, telegram bot pricing, telegram ai bot pricing, chatbot subscription pricing, telegram bot credit pack"
        structuredData={structuredData}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8 lg:p-10">
          <div className="inline-flex rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1 text-sm text-red-100">
            Pricing
          </div>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Simple pricing for Telegram AI bot deployment.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-zinc-300 md:text-lg">
            This page turns the in-product pricing signals into a clear public destination. It covers the Pro
            subscription, credit packs, and the next pages buyers usually want to compare.
          </p>
        </div>

        <aside className="rounded-[32px] border border-white/10 bg-[#090909] p-6">
          <p className="text-sm font-medium text-white">Current pricing signals</p>
          <div className="mt-4 space-y-3 text-sm leading-7 text-zinc-400">
            <p>SwiftDeploy Pro: $39/month</p>
            <p>Credit packs: $10, $25, $50, $100</p>
            <p>Higher-volume onboarding: contact SwiftDeploy</p>
          </div>
        </aside>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <article className="rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-sm font-medium text-white">Pro plan</p>
          <p className="mt-5 text-5xl font-semibold text-white">
            $39<span className="text-xl text-zinc-500">/month</span>
          </p>
          <div className="mt-5 space-y-3 text-sm leading-7 text-zinc-300">
            <p>Guided Telegram AI bot deployment</p>
            <p>Model selection in the setup flow</p>
            <p>Post-deployment command center and credit management</p>
            <p>Good fit for support, lead capture, and operations use cases</p>
          </div>
          <Link to="/login?mode=register" className="btn-deploy-gradient mt-6 inline-flex rounded-full px-5 py-3 text-sm font-medium">
            Start with Pro
          </Link>
        </article>

        <article className="rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-sm font-medium text-white">Credit packs</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {[10, 25, 50, 100].map((amount) => (
              <div key={amount} className="rounded-[24px] border border-white/8 bg-[#111114] p-5">
                <p className="text-3xl font-semibold text-white">${amount}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">Available as a recharge option in the bot management flow.</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm leading-7 text-zinc-400">
            If you need priority support or a larger rollout, contact SwiftDeploy about Pro Fleet or custom onboarding.
          </p>
        </article>
      </section>

      <section className="mt-8 rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <p className="text-sm font-medium text-white">Pricing FAQ</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {pricingFaq.map((item) => (
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
            <p className="text-sm font-medium text-white">Compare next</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Compare SwiftDeploy against custom development and generic bot paths.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400">
              Pricing is one part of the decision. Comparison pages help buyers understand when a deployment platform is a
              better fit than a custom build or a generic builder.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link to="/swiftdeploy-vs-custom-telegram-bot-development" className="btn-deploy-gradient rounded-full px-5 py-3 text-center text-sm font-medium">
              Compare to custom build
            </Link>
            <Link to="/telegram-bot-platform-comparison" className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Platform comparison
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
};

export default Pricing;
