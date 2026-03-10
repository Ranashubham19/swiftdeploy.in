import React from 'react';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';
import { buildBreadcrumbSchema, buildOrganizationSchema, buildWebPageSchema } from '../utils/seo';

const PrivacyPolicy: React.FC = () => {
  const effectiveDate = 'February 18, 2026';
  const title = 'Privacy Policy | SwiftDeploy';
  const description =
    'Read the SwiftDeploy privacy policy for details on account data, authentication, security controls, retention, and support requests.';

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/privacy"
        structuredData={[
          buildOrganizationSchema(),
          buildWebPageSchema({ name: title, description, path: '/privacy' }),
          buildBreadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Privacy Policy', path: '/privacy' }
          ])
        ]}
      />

      <section className="pt-8 text-center md:pt-12">
        <p className="text-sm text-red-400">Legal</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
          Privacy Policy
        </h1>
        <p className="mt-5 text-lg text-zinc-400">Effective date: {effectiveDate}</p>
      </section>

      <article className="mt-14 rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <div className="space-y-6 text-sm leading-7 text-zinc-300">
          <section>
            <h2 className="text-lg font-medium text-white">1. Information We Collect</h2>
            <p className="mt-2">We collect account details, authentication data, and service usage data needed to provide and secure SwiftDeploy.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">2. How We Use Data</h2>
            <p className="mt-2">We use data to operate the platform, authenticate users, prevent abuse, provide support, and improve reliability and performance.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">3. Third-Party Services</h2>
            <p className="mt-2">We use trusted infrastructure and integration providers when necessary to deliver core product functionality.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">4. Security</h2>
            <p className="mt-2">We apply technical and organizational controls including authentication checks, rate limits, and session protections.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">5. Data Sharing</h2>
            <p className="mt-2">We share data only with trusted service providers required for infrastructure, analytics, and security, or when required by law.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">6. Data Retention</h2>
            <p className="mt-2">We retain data only as long as needed for service delivery, legal obligations, dispute resolution, and security auditing.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">7. Your Rights</h2>
            <p className="mt-2">You may request access, correction, or deletion of personal data where applicable by contacting us below.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">8. Policy Updates</h2>
            <p className="mt-2">We may update this policy from time to time. Updated versions will be posted with a revised effective date.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">9. Contact</h2>
            <p className="mt-2">
              For privacy requests, contact
              {' '}
              <a href="mailto:ops@swiftdeploy.ai" className="text-white hover:text-zinc-300">ops@swiftdeploy.ai</a>.
            </p>
          </section>
        </div>
      </article>
    </MarketingShell>
  );
};

export default PrivacyPolicy;
