import React from 'react';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';
import { buildBreadcrumbSchema, buildOrganizationSchema, buildWebPageSchema } from '../utils/seo';

const TermsOfService: React.FC = () => {
  const effectiveDate = 'February 18, 2026';
  const title = 'Terms of Service | SwiftDeploy';
  const description =
    'Read the SwiftDeploy terms of service covering permitted use, account responsibility, service changes, and legal contact details.';

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/terms"
        structuredData={[
          buildOrganizationSchema(),
          buildWebPageSchema({ name: title, description, path: '/terms' }),
          buildBreadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Terms of Service', path: '/terms' }
          ])
        ]}
      />

      <section className="pt-8 text-center md:pt-12">
        <p className="text-sm text-red-400">Legal</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
          Terms of Service
        </h1>
        <p className="mt-5 text-lg text-zinc-400">Effective date: {effectiveDate}</p>
      </section>

      <article className="mt-14 rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
        <div className="space-y-6 text-sm leading-7 text-zinc-300">
          <section>
            <h2 className="text-lg font-medium text-white">1. Acceptance of Terms</h2>
            <p className="mt-2">By accessing or using SwiftDeploy, you agree to these Terms of Service and our Privacy Policy.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">2. Account and Security</h2>
            <p className="mt-2">You are responsible for maintaining account credentials, controlling access to your account, and all activity under your account.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">3. Permitted Use</h2>
            <p className="mt-2">You may use SwiftDeploy only for lawful purposes. You must not use the service for fraud, abuse, unauthorized access, spam, malware, or illegal content distribution.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">4. Service Scope and Changes</h2>
            <p className="mt-2">SwiftDeploy features may evolve over time. We may add, change, or remove capabilities to improve reliability, security, and product quality.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">5. Service Availability</h2>
            <p className="mt-2">We may update, suspend, or discontinue features at any time. We do not guarantee uninterrupted or error-free operation.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">6. Intellectual Property</h2>
            <p className="mt-2">SwiftDeploy branding, code, designs, and content remain the property of SwiftDeploy or its licensors.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">7. Limitation of Liability</h2>
            <p className="mt-2">To the maximum extent permitted by law, SwiftDeploy is not liable for indirect, incidental, special, or consequential damages arising from service use.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">8. Termination</h2>
            <p className="mt-2">We may suspend or terminate accounts that violate these terms or create security risk. You may stop using the service at any time.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">9. Changes to Terms</h2>
            <p className="mt-2">We may revise these terms from time to time. Continued use after updates means you accept the revised terms.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium text-white">10. Contact</h2>
            <p className="mt-2">
              For legal or compliance questions, contact
              {' '}
              <a href="mailto:ops@swiftdeploy.ai" className="text-white hover:text-zinc-300">ops@swiftdeploy.ai</a>.
            </p>
          </section>
        </div>
      </article>
    </MarketingShell>
  );
};

export default TermsOfService;
