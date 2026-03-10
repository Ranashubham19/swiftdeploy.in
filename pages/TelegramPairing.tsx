import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';

const TelegramPairing: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      navigate('/connect/telegram?stage=success', { replace: true });
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [navigate]);

  return (
    <>
      <Seo
        title="Pairing Telegram Bot | SwiftDeploy"
        description="Temporary provisioning step while SwiftDeploy pairs your Telegram bot."
        path="/connect/telegram/pairing"
        noindex
      />
      <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
        <section className="pt-8 text-center md:pt-12">
          <h1 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
            Pairing your Telegram bot
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-zinc-400">
            SwiftDeploy is completing the connection and preparing the live workspace.
          </p>
        </section>

        <div className="mx-auto mt-10 max-w-[760px]">
          <div className="rounded-[30px] border border-white/10 bg-[#0b0b0c] px-6 py-16 text-center shadow-[0_35px_90px_rgba(0,0,0,0.35)] md:px-10">
            <div className="mx-auto h-14 w-14 animate-spin rounded-full border-[3px] border-white/15 border-t-red-400" />
            <p className="mt-8 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Connection in progress
            </p>
            <p className="mt-4 text-base leading-7 text-zinc-400">
              This usually takes a few seconds. You will be redirected automatically when setup is complete.
            </p>
          </div>
        </div>
      </MarketingShell>
    </>
  );
};

export default TelegramPairing;
