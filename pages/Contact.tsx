import React, { useState } from 'react';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';
import { buildBreadcrumbSchema, buildOrganizationSchema, buildWebPageSchema } from '../utils/seo';

const Contact: React.FC = () => {
  const title = 'Contact SwiftDeploy | AI Bot Deployment Support';
  const description =
    'Contact SwiftDeploy for AI bot deployment help, Telegram bot setup questions, and support for business automation workflows.';
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      console.log('Contact form submitted:', formData);
      setSubmitStatus('success');
      setFormData({ name: '', email: '', subject: '', message: '' });
      setTimeout(() => setSubmitStatus('idle'), 3000);
    } catch (error) {
      console.error('Form submission error:', error);
      setSubmitStatus('error');
      setTimeout(() => setSubmitStatus('idle'), 3000);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
      <Seo
        title={title}
        description={description}
        path="/contact"
        keywords="contact swiftdeploy, telegram bot deployment support, ai bot setup help"
        structuredData={[
          buildOrganizationSchema(),
          buildWebPageSchema({ name: title, description, path: '/contact' }),
          buildBreadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Contact', path: '/contact' }
          ])
        ]}
      />

      <section className="pt-8 text-center md:pt-12">
        <p className="text-sm text-red-400">Contact</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
          Talk to the SwiftDeploy team
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          Use this form for setup help, pricing questions, or support requests related to Telegram AI bot deployment.
        </p>
      </section>

      <section className="mt-14 grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-zinc-400">Full name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-[#111114] px-4 py-3 text-white outline-none focus:border-white/20"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-zinc-400">Email address</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-[#111114] px-4 py-3 text-white outline-none focus:border-white/20"
                  placeholder="you@company.com"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-zinc-400">Subject</label>
              <input
                type="text"
                name="subject"
                value={formData.subject}
                onChange={handleInputChange}
                required
                className="w-full rounded-2xl border border-white/10 bg-[#111114] px-4 py-3 text-white outline-none focus:border-white/20"
                placeholder="How can we help?"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-zinc-400">Message</label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleInputChange}
                required
                rows={6}
                className="w-full resize-none rounded-2xl border border-white/10 bg-[#111114] px-4 py-3 text-white outline-none focus:border-white/20"
                placeholder="Tell us what you need."
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-2xl bg-[#6f6f76] px-6 py-4 text-base font-medium text-black transition-colors hover:bg-[#85858c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Sending...' : 'Send message'}
            </button>

            {submitStatus === 'success' ? (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                Message sent successfully. We will get back to you soon.
              </div>
            ) : null}

            {submitStatus === 'error' ? (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                Failed to send the message. Please try again.
              </div>
            ) : null}
          </form>
        </div>

        <aside className="rounded-[28px] border border-white/10 bg-[#090909] p-6 md:p-8">
          <p className="text-xl font-medium text-white">Contact details</p>
          <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
            <p>
              Email:
              {' '}
              <a href="mailto:ops@swiftdeploy.ai" className="text-white hover:text-zinc-300">
                ops@swiftdeploy.ai
              </a>
            </p>
            <p>Response time: under 2 hours for critical issues.</p>
            <p>Support hours: priority support is available for larger or urgent deployments.</p>
          </div>
        </aside>
      </section>
    </MarketingShell>
  );
};

export default Contact;
