import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bot, Platform, AIModel, BotStatus } from '../types';
import { ICONS } from '../constants';
import { apiUrl } from '../utils/api';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';

const ConnectDiscord: React.FC<{ user: any, bots: Bot[], setBots: any }> = ({ user, bots, setBots }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [botToken, setBotToken] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<'input' | 'verifying' | 'syncing'>('input');
  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [showManualPlay, setShowManualPlay] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const discordTutorialSteps = [
    <>Open <strong className="text-white">Discord Developer Portal</strong> and create/select your application.</>,
    <>Go to <strong className="text-white">Bot</strong> tab and copy your <strong className="text-white">Bot Token</strong>.</>,
    <>From <strong className="text-white">General Information</strong>, copy <strong className="text-white">Application ID</strong> and <strong className="text-white">Public Key</strong>.</>,
    <>Paste all credentials below to deploy the <strong className="text-white">AI command system</strong>.</>,
    <>After deploy, use <strong className="text-white">/ask</strong> in your Discord server for AI replies.</>
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setTutorialStep((prev) => (prev + 1) % discordTutorialSteps.length);
    }, 2600);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const node = videoRef.current;
    if (!node || videoError) return;
    node.muted = true;
    node.playsInline = true;
    node.play().then(() => {
      setShowManualPlay(false);
    }).catch(() => {
      setShowManualPlay(true);
    });
  }, [videoReady, videoError]);

  const handleManualPlay = async () => {
    const node = videoRef.current;
    if (!node) return;
    try {
      node.muted = true;
      await node.play();
      setShowManualPlay(false);
    } catch {
      setShowManualPlay(true);
    }
  };

  const handleConnect = async () => {
    if (!botToken || !applicationId || !publicKey) return;
    setIsDeploying(true);
    setDeployStep('verifying');
    await new Promise((r) => setTimeout(r, 1200));
    setDeployStep('syncing');
    await new Promise((r) => setTimeout(r, 1000));

    const botId = Math.random().toString(36).slice(2, 11);

    try {
      const response = await fetch(apiUrl('/deploy-discord-bot'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          botId,
          botToken: botToken.trim(),
          applicationId: applicationId.trim(),
          publicKey: publicKey.trim()
        })
      });

      const rawBody = await response.text();
      const result = (() => {
        try {
          return rawBody ? JSON.parse(rawBody) : {};
        } catch {
          return { message: rawBody };
        }
      })();

      if (!response.ok || !result?.success) {
        if (response.status === 401) {
          alert('Session expired. Please sign in again and retry Discord deployment.');
          navigate('/login?mode=login');
          return;
        }
        throw new Error(
          result?.details ||
          result?.error ||
          result?.message ||
          `Discord deployment failed (HTTP ${response.status})`
        );
      }

      const newBot: Bot = {
        id: botId,
        name: result.botName ? `${result.botName}` : `DiscordNode-${bots.length + 1}`,
        platform: Platform.DISCORD,
        token: botToken,
        model: location.state?.model || AIModel.OPENROUTER_FREE,
        status: BotStatus.ACTIVE,
        messageCount: 0,
        tokenUsage: 0,
        lastActive: new Date().toISOString(),
        memoryEnabled: true,
        webhookUrl: result.interactionUrl
      };

      setBots([newBot, ...bots]);
      if (result.inviteUrl) {
        window.open(result.inviteUrl, '_blank', 'noopener,noreferrer');
      }
      navigate('/');
    } catch (error: any) {
      alert(`Deployment failed: ${error?.message || 'Unable to connect to backend.'}`);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <>
      <Seo
        title="Connect Discord Bot | SwiftDeploy"
        description="Provisioning flow for connecting a Discord bot to SwiftDeploy."
        path="/connect/discord"
        noindex
      />
      <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
        <section className="pt-8 text-center md:pt-12">
          <h1 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
            Connect Discord in one guided flow
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
            Paste the credentials, review the preview, and finish the setup from one simple card.
          </p>
        </section>

        <div className="relative mx-auto mt-10 max-w-[920px]">
          {isDeploying ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[30px] bg-black/70 backdrop-blur-sm">
              <div className="rounded-[28px] border border-white/10 bg-[#0b0b0c] px-8 py-7 text-center shadow-[0_25px_70px_rgba(0,0,0,0.45)]">
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-red-400" />
                <p className="mt-5 text-base font-medium text-white">
                  {deployStep === 'verifying' ? 'Verifying Discord credentials' : 'Publishing slash commands'}
                </p>
                <p className="mt-2 text-sm text-zinc-500">This usually takes a few seconds.</p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_430px]">
            <section className="rounded-[30px] border border-white/10 bg-[#0b0b0c] p-6 md:p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03]">
                  <ICONS.Discord className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-lg font-medium text-white">Discord connection</p>
                  <p className="text-sm text-zinc-500">A cleaner form with the same deploy logic underneath.</p>
                </div>
              </div>

              <div className="mt-8 grid gap-3">
                {discordTutorialSteps.map((step, i) => (
                  <div key={i} className="rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-6 text-zinc-300">
                    <span className="mr-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500/12 text-xs text-red-100">
                      {i + 1}
                    </span>
                    {step}
                  </div>
                ))}
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-zinc-400">Bot token</label>
                  <input
                    type="password"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="Discord bot token"
                    className="w-full rounded-[22px] border border-white/8 bg-[#111114] px-4 py-3.5 text-white outline-none transition-colors focus:border-red-400/25"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-zinc-400">Application ID</label>
                  <input
                    type="text"
                    value={applicationId}
                    onChange={(e) => setApplicationId(e.target.value)}
                    placeholder="123456789012345678"
                    className="w-full rounded-[22px] border border-white/8 bg-[#111114] px-4 py-3.5 text-white outline-none transition-colors focus:border-red-400/25"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-zinc-400">Public key</label>
                  <input
                    type="text"
                    value={publicKey}
                    onChange={(e) => setPublicKey(e.target.value)}
                    placeholder="64-character public key"
                    className="w-full rounded-[22px] border border-white/8 bg-[#111114] px-4 py-3.5 text-white outline-none transition-colors focus:border-red-400/25"
                  />
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4">
                  <p className="text-sm font-medium text-white">{user?.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{user?.email}</p>
                </div>
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={isDeploying || !botToken || !applicationId || !publicKey}
                  className="btn-deploy-gradient rounded-full px-6 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Deploy Discord bot
                </button>
              </div>
            </section>

            <aside className="space-y-6">
              <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[#0b0b0c]">
                <div className="border-b border-white/8 px-5 py-4">
                  <p className="text-sm font-medium text-white">Setup guide</p>
                  <p className="text-xs text-zinc-500">Wide preview instead of the old narrow phone mockup.</p>
                </div>

                {!videoError ? (
                  <div className="relative">
                    <video
                      ref={videoRef}
                      autoPlay
                      loop
                      muted
                      playsInline
                      controls
                      preload="auto"
                      className="aspect-[16/11] w-full bg-black object-cover"
                      onLoadedData={() => setVideoReady(true)}
                      onError={() => setVideoError(true)}
                    >
                      <source src="/videos/discord-demo.mp4" type="video/mp4" />
                      <source src="/videos/discord-demo.webm" type="video/webm" />
                      <source src="/videos/demo.mp4" type="video/mp4" />
                    </video>
                    {showManualPlay ? (
                      <button
                        type="button"
                        onClick={handleManualPlay}
                        className="absolute inset-x-5 bottom-5 rounded-full bg-red-500 px-4 py-2 text-sm text-white"
                      >
                        Play video
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="p-5">
                    <p className="text-sm text-zinc-400">
                      Video preview is unavailable, so the guide is rotating through the setup steps below.
                    </p>
                    <div className="mt-4 rounded-[22px] border border-white/8 bg-[#111114] p-4">
                      <p className="text-xs text-zinc-500">
                        Step {tutorialStep + 1} of {discordTutorialSteps.length}
                      </p>
                      <div className="mt-3 text-sm leading-6 text-zinc-200">{discordTutorialSteps[tutorialStep]}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-[30px] border border-white/10 bg-[#0b0b0c] p-5">
                <p className="text-sm font-medium text-white">After deployment</p>
                <div className="mt-4 space-y-3">
                  {[
                    'The bot is added to your workspace and saved to your account.',
                    'If Discord returns an invite URL, it opens automatically in a new tab.',
                    'You can come back and use Telegram setup from the same sidebar.'
                  ].map((item) => (
                    <div key={item} className="rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-6 text-zinc-300">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </MarketingShell>
    </>
  );
};

export default ConnectDiscord;
