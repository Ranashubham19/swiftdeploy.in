import React from 'react';
import { Link } from 'react-router-dom';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';
import {
  buildBreadcrumbSchema,
  buildOrganizationSchema,
  buildServiceSchema,
  buildWebPageSchema
} from '../utils/seo';

const capabilityCards = [
  {
    title: 'Natural language task creation',
    description: 'Create internet automations in plain English, then let the platform convert them into structured browser workflows.'
  },
  {
    title: 'Browser automation engine',
    description: 'Open websites, search, click, scroll, extract data, and capture content with reusable automation steps.'
  },
  {
    title: 'Scheduled execution',
    description: 'Run hourly, daily, or weekly workers in the background so monitoring and recurring tasks keep happening automatically.'
  },
  {
    title: 'Notification delivery',
    description: 'Push important updates through Telegram and email when a tracked condition is met.'
  },
  {
    title: 'Result history and logs',
    description: 'Store execution results, changes over time, and run logs so users can review what happened and when.'
  },
  {
    title: 'Self-healing automation',
    description: 'If a website changes its layout, the worker can detect failed selectors, search for alternatives, update the step, and retry.'
  }
];

const workflowSteps = [
  'Describe the internet task in natural language.',
  'Let the AI interpreter turn it into a structured execution plan.',
  'Run the automation on schedule, store results, and send alerts automatically.'
];

const Features: React.FC = () => {
  const title = 'AI Internet Worker Features for Monitoring and Automation | SwiftDeploy';
  const description =
    'Explore SwiftDeploy features for AI internet workers, browser automation, price tracking, website monitoring, scheduled runs, notifications, and self-healing execution.';

  const structuredData = [
    buildOrganizationSchema(),
    buildWebPageSchema({
      name: title,
      description,
      path: '/features'
    }),
    buildServiceSchema({
      name: 'SwiftDeploy AI internet worker features',
      description,
      path: '/features',
      serviceType: 'AI internet worker deployment and automation'
    }),
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Features', path: '/features' }
    ])
  ];

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/features"
        keywords="ai internet worker features, browser automation saas, website monitoring, price tracking automation, self-healing web automation"
        structuredData={structuredData}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8 lg:p-10">
          <div className="inline-flex rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1 text-sm text-red-100">
            Product features
          </div>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Features built for AI internet workers and recurring web automation.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-zinc-300 md:text-lg">
            SwiftDeploy combines guided deployment with internet-worker automation: natural language task creation,
            browser execution, scheduling, notifications, logs, and self-repair when websites change.
          </p>
        </div>

        <aside className="rounded-[32px] border border-white/10 bg-[#090909] p-6">
          <p className="text-sm font-medium text-white">Why this page matters</p>
          <p className="mt-4 text-sm leading-7 text-zinc-400">
            This page explains the product as one system: deployment, automation, monitoring, notifications, and repair logic in a single SaaS workflow.
          </p>
        </aside>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {capabilityCards.map((card) => (
          <article key={card.title} className="rounded-[28px] border border-white/10 bg-[#090909] p-6">
            <p className="text-sm font-medium text-white">{card.title}</p>
            <p className="mt-3 text-sm leading-7 text-zinc-400">{card.description}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-2">
        <article className="rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-sm font-medium text-white">Worker workflow</p>
          <div className="mt-5 space-y-3">
            {workflowSteps.map((step, index) => (
              <div key={step} className="rounded-[24px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-7 text-zinc-300">
                <span className="mr-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500/12 text-xs text-red-100">
                  {index + 1}
                </span>
                {step}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-sm font-medium text-white">Best-fit use cases</p>
          <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
            <p>Track prices on e-commerce websites and send alerts when a threshold is reached.</p>
            <p>Monitor remote job listings, AI news sources, and competitor webpages on a recurring schedule.</p>
            <p>Watch key pages for changes and deliver results through Telegram or email without manual checking.</p>
          </div>
        </article>
      </section>

      <section className="mt-8 rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <p className="text-sm font-medium text-white">Worker examples</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            {
              title: 'Track Amazon prices',
              path: '/',
              description: 'Follow product price movements and get notified when the value changes.'
            },
            {
              title: 'Watch remote job boards',
              path: '/',
              description: 'Collect new roles from selected websites and deliver a daily shortlist.'
            },
            {
              title: 'Detect webpage changes',
              path: '/',
              description: 'Store previous page versions and alert users when content is updated.'
            }
          ].map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="rounded-[24px] border border-white/8 bg-[#111114] p-5 transition-colors hover:border-white/12"
            >
              <p className="text-base font-medium text-white">{item.title}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{item.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-[32px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-center">
          <div>
            <p className="text-sm font-medium text-white">Next step</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Start with the same guided deployment flow and launch your first AI internet worker.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400">
              Use the homepage setup flow to choose a model, connect your alert channel, and turn a natural language task into a live worker.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link to="/internet-worker" className="btn-deploy-gradient rounded-full px-5 py-3 text-center text-sm font-medium">
              Open worker dashboard
            </Link>
            <Link to="/" className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-center text-sm text-white">
              Open deployment flow
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
};

export default Features;
