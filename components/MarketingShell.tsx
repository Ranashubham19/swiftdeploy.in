import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from './BrandLogo';

interface MarketingShellProps {
  children: React.ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
}

const MarketingShell: React.FC<MarketingShellProps> = ({
  children,
  ctaLabel = 'Contact Support',
  ctaHref = '/contact'
}) => {
  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100">
      <div className="stars" />
      <div className="glitter-field" />

      <header className="sticky top-0 z-40 bg-[#050505]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-5 px-4 py-6 md:px-6 md:py-8">
          <Link to="/" className="shrink-0">
            <BrandLogo />
          </Link>

          <Link
            to={ctaHref}
            className="inline-flex items-center gap-2 border-b border-white/20 pb-1 text-sm text-zinc-300 transition-colors hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z" />
            </svg>
            {ctaLabel}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-4 py-6 md:px-6 md:py-8">{children}</main>

      <footer className="pb-12 pt-8">
        <div className="mx-auto flex max-w-[1080px] flex-col items-center gap-4 px-4 text-center md:px-6">
          <BrandLogo compact />
          <p className="max-w-[520px] text-sm leading-7 text-zinc-500">
            SwiftDeploy gives teams one platform for OpenClaw deployment, AI internet workers, and recurring browser automation without manual infrastructure setup.
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 border-b border-white/20 pb-1 text-sm text-zinc-400 transition-colors hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z" />
            </svg>
            Contact Support
          </Link>
        </div>
      </footer>
    </div>
  );
};

export default MarketingShell;
