import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bot, Platform, AIModel, BotStatus } from '../types';
import { ICONS } from '../constants';
import { apiUrl } from '../utils/api';
import MarketingShell from '../components/MarketingShell';
import Seo from '../components/Seo';

type FlowStep = 'token' | 'send-first-message' | 'success';
type DeployStep = 'input' | 'verifying' | 'provisioning' | 'webhooking';
const DISPLAY_AI_MODEL_NAME = 'GPT-5.2 MODEL';
const getDisplayAiModelName = () => DISPLAY_AI_MODEL_NAME;
const FIRST_BOT_SUBSCRIPTION_ENABLED = true;
const SHOW_RUNTIME_BADGES = false;
const AUTH_REQUIRED_MESSAGE = 'Authentication required. Please sign in again.';

const ConnectTelegram: React.FC<{ user: any; bots: Bot[]; setBots: any }> = ({ user, bots, setBots }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const stage = urlParams.get('stage') || '';
  const stageView = urlParams.get('view') || '';
  const isDemoStage = urlParams.get('demo') === '1';
  const isExistingView = stageView === 'existing';
  const isSuccessStage = stage === 'success';
  const proCheckoutStatus = urlParams.get('proCheckout') || '';
  const proSessionId = urlParams.get('proSessionId') || '';
  const stageBotUsername = urlParams.get('bot') || '';
  const stageBotName = urlParams.get('botName') || '';
  const stageBotId = urlParams.get('botId') || '';
  const stripeCheckoutStatus = urlParams.get('stripeCheckout') || '';
  const stripeSessionId = urlParams.get('stripeSessionId') || '';
  const stageBotLink = stageBotUsername ? `https://t.me/${stageBotUsername}` : '';
  const selectedModelFromState = String(location.state?.model || '').trim();
  const selectedModel: AIModel = Object.values(AIModel).includes(selectedModelFromState as AIModel)
    ? (selectedModelFromState as AIModel)
    : AIModel.OPENROUTER_FREE;

  const [token, setToken] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<DeployStep>('input');
  const [flowStep, setFlowStep] = useState<FlowStep>(() => {
    if (isSuccessStage) return 'success';
    return 'token';
  });
  const [isDemoModeActive, setIsDemoModeActive] = useState<boolean>(isDemoStage);
  const [deployError, setDeployError] = useState('');
  const [showConnectedToast, setShowConnectedToast] = useState(false);
  const [connectedBotUsername, setConnectedBotUsername] = useState(stageBotUsername);
  const [connectedBotName, setConnectedBotName] = useState(stageBotName);
  const [connectedBotId, setConnectedBotId] = useState(stageBotId);
  const [connectedBotLink, setConnectedBotLink] = useState(stageBotLink);
  const [connectedAiProvider, setConnectedAiProvider] = useState('');
  const [connectedAiModel, setConnectedAiModel] = useState('');
  const [creditRemainingUsd, setCreditRemainingUsd] = useState<number | null>(null);
  const [creditDepleted, setCreditDepleted] = useState(false);
  const [creditWarning, setCreditWarning] = useState('');
  const [proSubscriptionActive, setProSubscriptionActive] = useState(false);
  const [proSubscriptionStatus, setProSubscriptionStatus] = useState<'ACTIVE' | 'EXPIRED' | 'NONE'>('NONE');
  const [isCreditLoading, setIsCreditLoading] = useState(false);
  const [selectedTopUpUsd, setSelectedTopUpUsd] = useState<number>(0);
  const [isPurchasingCredit, setIsPurchasingCredit] = useState(false);
  const [creditActionMessage, setCreditActionMessage] = useState('');
  const [creditActionError, setCreditActionError] = useState('');
  const [flowNoticeMessage, setFlowNoticeMessage] = useState('');
  const [flowNoticeError, setFlowNoticeError] = useState('');
  const [isStartingProSubscription, setIsStartingProSubscription] = useState(false);
  const confirmedStripeSessionIdsRef = useRef<Set<string>>(new Set());
  const confirmedProSubscriptionSessionIdsRef = useRef<Set<string>>(new Set());
  const authRedirectTriggeredRef = useRef(false);
  const STRIPE_PENDING_CHECKOUT_KEY = 'swiftdeploy_pending_credit_checkout';
  const STRIPE_PENDING_CHECKOUT_TTL_MS = 30 * 60 * 1000;
  const FLOW_BANNER_TTL_MS = 5000;
  const PRO_SUB_PENDING_DEPLOY_KEY = 'swiftdeploy_pending_first_bot_deploy';
  const PRO_SUB_PENDING_CHECKOUT_KEY = 'swiftdeploy_pending_pro_subscription_checkout';
  const PRO_SUB_PENDING_CHECKOUT_TTL_MS = 30 * 60 * 1000;
  const readPendingStripeCheckoutMarker = (): { botId: string; amountUsd: number; startedAt: number } | null => {
    try {
      const raw = window.sessionStorage.getItem(STRIPE_PENDING_CHECKOUT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const botId = String(parsed?.botId || '').trim();
      const amountUsd = Math.floor(Number(parsed?.amountUsd || 0));
      const startedAt = Number(parsed?.startedAt || 0);
      if (!botId) return null;
      return {
        botId,
        amountUsd: Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : 0,
        startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0
      };
    } catch {
      return null;
    }
  };
  const clearPendingStripeCheckoutMarker = () => {
    try {
      window.sessionStorage.removeItem(STRIPE_PENDING_CHECKOUT_KEY);
    } catch {}
  };
  const readPendingProSubscriptionCheckoutMarker = (): { startedAt: number } | null => {
    try {
      const raw = window.sessionStorage.getItem(PRO_SUB_PENDING_CHECKOUT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const startedAt = Number(parsed?.startedAt || 0);
      return {
        startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0
      };
    } catch {
      return null;
    }
  };
  const clearPendingProSubscriptionCheckoutMarker = () => {
    try {
      window.sessionStorage.removeItem(PRO_SUB_PENDING_CHECKOUT_KEY);
    } catch {}
  };
  const readPendingFirstBotDeploy = (): { botToken: string; model: string; startedAt: number } | null => {
    try {
      const raw = window.sessionStorage.getItem(PRO_SUB_PENDING_DEPLOY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const botToken = String(parsed?.botToken || '').trim();
      const model = String(parsed?.model || '').trim();
      const startedAt = Number(parsed?.startedAt || 0);
      if (!botToken) return null;
      return {
        botToken,
        model,
        startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0
      };
    } catch {
      return null;
    }
  };
  const clearPendingFirstBotDeploy = () => {
    try {
      window.sessionStorage.removeItem(PRO_SUB_PENDING_DEPLOY_KEY);
    } catch {}
  };
  const buildLoginRedirectPath = () => `/connect/telegram${location.search || ''}`;
  const handleAuthenticationRequired = (message?: string) => {
    if (authRedirectTriggeredRef.current) return;
    authRedirectTriggeredRef.current = true;
    const authMessage = String(message || '').trim() || AUTH_REQUIRED_MESSAGE;
    setIsDeploying(false);
    setDeployStep('input');
    setIsStartingProSubscription(false);
    setIsPurchasingCredit(false);
    setFlowNoticeMessage('');
    setCreditActionMessage('');
    setDeployError(authMessage);
    setFlowNoticeError(authMessage);
    setCreditActionError(authMessage);
    navigate('/login', {
      replace: true,
      state: { redirectTo: buildLoginRedirectPath() }
    });
  };
  const parseDeployResponse = async (response: Response): Promise<any> => {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      return response.json().catch(() => ({}));
    }
    const rawText = await response.text().catch(() => '');
    return { rawText };
  };

  const formatDeployError = (result: any, statusCode: number): string => {
    const errorText = String(result?.error || result?.message || '').trim();
    const detailsText = String(result?.details || '').trim();
    const rawText = String(result?.rawText || '').trim();
    const combinedText = `${errorText} ${detailsText} ${rawText}`.toLowerCase();
    if (statusCode === 401 || /authentication required|not authenticated|unauthorized/.test(combinedText)) {
      return AUTH_REQUIRED_MESSAGE;
    }
    if (errorText && detailsText) return `${errorText}: ${detailsText}`;
    if (errorText) return errorText;
    if (detailsText) return detailsText;
    if (statusCode === 404 || statusCode === 405) return 'Deploy endpoint not found. Backend is not in provisioning mode.';
    if (/<!doctype html>|<html/i.test(rawText)) {
      return 'Backend API is not connected. Set Vercel BACKEND_API_URL (or VITE_API_URL) to your Railway backend URL.';
    }
    if (rawText) {
      return 'Backend returned a non-JSON response. Check API routing configuration.';
    }
    return 'Deployment failed';
  };

  const validateTokenBeforeSubscription = async (botTokenValue: string) => {
    const tokenToUse = String(botTokenValue || '').trim();
    if (!tokenToUse) {
      throw new Error('Bot token is required.');
    }

    // Fast local guard to stop invalid/duplicate input before subscription checkout.
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(tokenToUse)) {
      throw new Error('Bot token is wrong. Please enter a valid token number.');
    }

    const alreadyUsedInCurrentAccount = bots.some((bot) => {
      if (bot.platform !== Platform.TELEGRAM) return false;
      return String(bot.token || '').trim() === tokenToUse;
    });
    if (alreadyUsedInCurrentAccount) {
      throw new Error('Bot token is already taken. Please enter another valid token number.');
    }

    const response = await fetch(apiUrl('/deploy-bot/validate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-token': tokenToUse
      },
      credentials: 'include',
      body: JSON.stringify({})
    });

    const result = await parseDeployResponse(response);
    if (response.status === 401) {
      handleAuthenticationRequired(formatDeployError(result, response.status));
      throw new Error(AUTH_REQUIRED_MESSAGE);
    }
    if (response.ok && result?.success) return;

    const combined = `${String(result?.error || '')} ${String(result?.message || '')} ${String(result?.details || '')}`
      .trim()
      .toLowerCase();

    if (/already exists|already connected|belongs to another account|already taken/.test(combined)) {
      throw new Error('Bot token is already taken. Please enter another valid token number.');
    }

    if (
      /invalid telegram|token format|botfather|token is required|username missing|primary telegram token/.test(combined)
    ) {
      throw new Error('Bot token is wrong. Please enter a valid token number.');
    }

    if (response.status === 404 || response.status === 405 || /backend api is not connected/.test(combined)) {
      throw new Error('Connection issue. Please refresh once and try again.');
    }

    throw new Error(
      String(result?.message || result?.error || result?.details || 'Unable to validate bot token right now.')
    );
  };

  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [showManualPlay, setShowManualPlay] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const selectedModelDisplay = getDisplayAiModelName();
  const connectedAiModelDisplay = connectedAiModel ? getDisplayAiModelName() : '';

  useEffect(() => {
    const node = videoRef.current;
    if (!node || videoError) return;
    node.muted = true;
    node.playsInline = true;
    node
      .play()
      .then(() => {
        setShowManualPlay(false);
      })
      .catch(() => {
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

  const generateDemoToken = () => {
    setIsDemoModeActive(true);
    setDeployError('');
    setFlowNoticeError('');
    setFlowNoticeMessage('Demo Mode enabled. This preview will simulate setup and will not create a real AI bot.');
    setToken('1234567890:DEMO_BOTFATHER_TOKEN_PREVIEW_ONLY_ABC123xyz');
  };

  const applyCreditPayload = (data: any) => {
    const remaining = Number(data?.remainingUsd);
    setCreditRemainingUsd(Number.isFinite(remaining) ? remaining : 0);
    setCreditDepleted(Boolean(data?.depleted));
    setCreditWarning(String(data?.warning || '').trim());
    setProSubscriptionActive(Boolean(data?.proSubscriptionActive));
    const status = String(data?.proSubscriptionStatus || '').trim().toUpperCase();
    if (status === 'ACTIVE' || status === 'EXPIRED' || status === 'NONE') {
      setProSubscriptionStatus(status as 'ACTIVE' | 'EXPIRED' | 'NONE');
    }
  };

  // Existing users who already have an active Telegram bot should land on the success page directly.
  useEffect(() => {
    if (isSuccessStage || isDemoModeActive || isDemoStage) return;
    const existingBot = bots.find((b) => b.platform === Platform.TELEGRAM);
    if (!existingBot) return;

    let active = true;
    const redirectToSuccess = async () => {
      setDeployError('');
      setIsDeploying(true);
      setDeployStep('verifying');
      await new Promise((r) => setTimeout(r, 700));
      if (!active) return;
      setIsDeploying(false);
      setDeployStep('input');

      const params = new URLSearchParams();
      params.set('stage', 'success');
      params.set('view', 'existing');
      params.set('botId', existingBot.id);
      const username =
        existingBot.telegramUsername ||
        (existingBot.name?.startsWith('@') ? existingBot.name.slice(1) : '');
      if (username) params.set('bot', username);
      const existingName = String(existingBot.name || '').trim();
      if (existingName) params.set('botName', existingName);
      navigate(`/connect/telegram?${params.toString()}`, { replace: true, state: location.state });
    };

    redirectToSuccess();
    return () => {
      active = false;
    };
  }, [isSuccessStage, isDemoModeActive, isDemoStage, bots, navigate, location.state]);

  // Keep UI state in sync when the URL contains a success stage.
  useEffect(() => {
    if (!isSuccessStage) return;
    setFlowStep('success');
    if (isDemoStage) setIsDemoModeActive(true);
    if (stageBotUsername) setConnectedBotUsername(stageBotUsername);
    if (stageBotName) setConnectedBotName(stageBotName);
    if (stageBotId) setConnectedBotId(stageBotId);
    if (stageBotLink) setConnectedBotLink(stageBotLink);
  }, [isSuccessStage, isDemoStage, stageBotUsername, stageBotName, stageBotId, stageBotLink]);

  useEffect(() => {
    if (!isSuccessStage || !stageBotId || isDemoModeActive || isDemoStage) return;
    let active = true;
    const loadBotProfile = async () => {
      try {
        const response = await fetch(apiUrl(`/bot-profile/${encodeURIComponent(stageBotId)}`), {
          credentials: 'include'
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          handleAuthenticationRequired(String(data?.message || data?.error || AUTH_REQUIRED_MESSAGE));
          return;
        }
        if (!active || !response.ok || !data?.success) return;
        const name = String(data.botName || '').trim();
        const username = String(data.botUsername || '').trim();
        if (name) setConnectedBotName(name);
        if (username) setConnectedBotUsername(username);
        if (!connectedBotLink && username) setConnectedBotLink(`https://t.me/${username}`);
      } catch {}
    };
    loadBotProfile();
    return () => {
      active = false;
    };
  }, [isSuccessStage, stageBotId, connectedBotLink, isDemoModeActive, isDemoStage]);

  useEffect(() => {
    if (flowStep !== 'success' || !connectedBotId || isDemoModeActive || isDemoStage) return;
    let active = true;
    let pollTimer: number | null = null;

    const loadCredit = async (showLoader = false) => {
      if (showLoader && active) setIsCreditLoading(true);
      try {
        const response = await fetch(apiUrl(`/bot-credit/${encodeURIComponent(connectedBotId)}`), {
          credentials: 'include'
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          handleAuthenticationRequired(String(data?.message || data?.error || AUTH_REQUIRED_MESSAGE));
          return;
        }
        if (!active || !response.ok || !data?.success) return;
        applyCreditPayload(data);
      } catch {
        // Keep UI resilient if credit endpoint is unavailable.
      } finally {
        if (showLoader && active) setIsCreditLoading(false);
      }
    };

    void loadCredit(true);
    pollTimer = window.setInterval(() => {
      void loadCredit(false);
    }, 15000);
    return () => {
      active = false;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [flowStep, connectedBotId, isDemoModeActive, isDemoStage]);

  useEffect(() => {
    if (!creditActionMessage) return;
    const timer = window.setTimeout(() => setCreditActionMessage(''), FLOW_BANNER_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [creditActionMessage, FLOW_BANNER_TTL_MS]);

  useEffect(() => {
    if (!creditActionError) return;
    const timer = window.setTimeout(() => setCreditActionError(''), FLOW_BANNER_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [creditActionError, FLOW_BANNER_TTL_MS]);

  useEffect(() => {
    if (!flowNoticeMessage) return;
    const timer = window.setTimeout(() => setFlowNoticeMessage(''), FLOW_BANNER_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [flowNoticeMessage, FLOW_BANNER_TTL_MS]);

  useEffect(() => {
    if (!flowNoticeError) return;
    const timer = window.setTimeout(() => setFlowNoticeError(''), FLOW_BANNER_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [flowNoticeError, FLOW_BANNER_TTL_MS]);

  useEffect(() => {
    if (flowStep !== 'success' || !connectedBotId) return;
    if (!stripeCheckoutStatus) return;

    if (stripeCheckoutStatus === 'cancel') {
      clearPendingStripeCheckoutMarker();
      setIsPurchasingCredit(false);
      setCreditActionMessage('');
      setCreditActionError('Payment was not completed. Stripe checkout was canceled and no credits were added.');
      return;
    }

    if (stripeCheckoutStatus !== 'success' || !stripeSessionId) return;
    clearPendingStripeCheckoutMarker();
    setIsPurchasingCredit(false);
    if (confirmedStripeSessionIdsRef.current.has(stripeSessionId)) return;
    confirmedStripeSessionIdsRef.current.add(stripeSessionId);

    let active = true;
    const confirmStripeCheckout = async () => {
      setCreditActionError('');
      setCreditActionMessage('Finalizing your payment and updating credits...');
      try {
        const response = await fetch(apiUrl(`/bot-credit/${encodeURIComponent(connectedBotId)}/checkout/confirm`), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stripeSessionId })
        });
        const data = await response.json().catch(() => ({}));
        if (!active) return;
        if (response.status === 401) {
          handleAuthenticationRequired(String(data?.message || data?.error || AUTH_REQUIRED_MESSAGE));
          return;
        }
        if (!response.ok && !data?.pending) {
          throw new Error(String(data?.message || data?.error || 'Unable to confirm Stripe payment right now.'));
        }
        if (data?.success) {
          applyCreditPayload(data);
          const added = Math.floor(Number(data.amountUsdAdded || 0));
          setCreditActionMessage(
            added > 0
              ? `Payment completed successfully. $${added} credit has been added to your bot balance.`
              : 'Payment completed successfully. Your credit balance has been refreshed.'
          );
          return;
        }
        setCreditActionMessage('Payment received. We are securely updating your credit balance. It will refresh automatically.');
      } catch (error: any) {
        if (!active) return;
        setCreditActionMessage('');
        setCreditActionError(error?.message || 'Unable to confirm Stripe payment right now.');
      }
    };

    void confirmStripeCheckout();
    return () => {
      active = false;
    };
  }, [flowStep, connectedBotId, stripeCheckoutStatus, stripeSessionId]);

  useEffect(() => {
    if (!FIRST_BOT_SUBSCRIPTION_ENABLED) return;
    if (flowStep === 'success') return;
    if (!proCheckoutStatus) return;

    if (proCheckoutStatus === 'cancel') {
      clearPendingProSubscriptionCheckoutMarker();
      setIsStartingProSubscription(false);
      setFlowNoticeMessage('');
      setFlowNoticeError('Payment was not completed. Pro subscription checkout was canceled.');
      navigate('/connect/telegram', { replace: true, state: location.state });
      return;
    }

    if (proCheckoutStatus !== 'success' || !proSessionId) return;
    clearPendingProSubscriptionCheckoutMarker();
    setIsStartingProSubscription(false);
    if (confirmedProSubscriptionSessionIdsRef.current.has(proSessionId)) return;
    confirmedProSubscriptionSessionIdsRef.current.add(proSessionId);

    let active = true;
    const confirmProSubscriptionAndDeploy = async () => {
      setFlowNoticeError('');
      setFlowNoticeMessage('Verifying your Pro subscription payment...');
      try {
        const pendingDeploy = readPendingFirstBotDeploy();
        if (!pendingDeploy?.botToken) {
          throw new Error('Payment was completed, but your pending bot setup data is missing. Please contact support.');
        }

        const confirmResponse = await fetch(apiUrl('/pro-subscription/checkout/confirm'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stripeSessionId: proSessionId })
        });
        const confirmData = await confirmResponse.json().catch(() => ({}));
        if (!active) return;
        if (confirmResponse.status === 401) {
          handleAuthenticationRequired(String(confirmData?.message || confirmData?.error || AUTH_REQUIRED_MESSAGE));
          return;
        }
        if (!confirmResponse.ok && !confirmData?.pending) {
          throw new Error(String(confirmData?.message || confirmData?.error || 'Unable to confirm Pro subscription payment right now.'));
        }
        if (!confirmData?.success) {
          setFlowNoticeMessage('');
          setFlowNoticeError('Payment is not completed yet. Complete the Pro subscription checkout to continue setup.');
          return;
        }

        setFlowNoticeMessage('Payment completed successfully. SwiftDeploy Pro ($39/month) is active. Finishing bot setup...');
        navigate('/connect/telegram', { replace: true, state: location.state });
        await deployBotWithToken(pendingDeploy.botToken, pendingDeploy.model || selectedModel);
        clearPendingFirstBotDeploy();
      } catch (error: any) {
        if (!active) return;
        setFlowNoticeMessage('');
        setFlowNoticeError(error?.message || 'Unable to continue bot setup after payment.');
      }
    };

    void confirmProSubscriptionAndDeploy();
    return () => {
      active = false;
    };
  }, [flowStep, proCheckoutStatus, proSessionId, navigate, location.state, selectedModel]);

  useEffect(() => {
    if (!FIRST_BOT_SUBSCRIPTION_ENABLED) return;
    if (flowStep === 'success') return;
    if (proCheckoutStatus || proSessionId) return;

    const handlePossibleAbandonedProSubscriptionCheckout = () => {
      if (proCheckoutStatus || proSessionId) return;
      const pending = readPendingProSubscriptionCheckoutMarker();
      if (!pending) return;
      const isRecent = (Date.now() - Number(pending.startedAt || 0)) <= PRO_SUB_PENDING_CHECKOUT_TTL_MS;
      const looksLikeRedirectState =
        isStartingProSubscription || /(opening|redirecting).*pro subscription/i.test(String(flowNoticeMessage || ''));

      if (!isRecent && !looksLikeRedirectState) {
        clearPendingProSubscriptionCheckoutMarker();
        return;
      }
      if (!isRecent) return;

      clearPendingProSubscriptionCheckoutMarker();
      setIsStartingProSubscription(false);
      setFlowNoticeMessage('');
      setFlowNoticeError('Payment not completed. Complete the Pro subscription checkout to continue setup.');
    };

    const onPageShow = () => window.setTimeout(handlePossibleAbandonedProSubscriptionCheckout, 80);
    const onFocus = () => window.setTimeout(handlePossibleAbandonedProSubscriptionCheckout, 80);
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      window.setTimeout(handlePossibleAbandonedProSubscriptionCheckout, 80);
    };

    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    flowStep,
    proCheckoutStatus,
    proSessionId,
    isStartingProSubscription,
    flowNoticeMessage,
    PRO_SUB_PENDING_CHECKOUT_TTL_MS
  ]);

  useEffect(() => {
    if (flowStep !== 'success' || !connectedBotId) return;

    const handlePossibleAbandonedStripeCheckout = () => {
      if (stripeCheckoutStatus || stripeSessionId) return;

      const pending = readPendingStripeCheckoutMarker();
      const pendingForThisBot = pending && pending.botId === connectedBotId;
      const pendingIsRecent = pendingForThisBot
        ? (Date.now() - Number(pending?.startedAt || 0)) <= STRIPE_PENDING_CHECKOUT_TTL_MS
        : false;
      const looksLikeRedirectState =
        isPurchasingCredit || /(redirecting|opening) to secure stripe checkout/i.test(String(creditActionMessage || ''));

      if (!pendingForThisBot && !looksLikeRedirectState) return;

      if (pendingForThisBot && !pendingIsRecent && !looksLikeRedirectState) {
        clearPendingStripeCheckoutMarker();
        return;
      }

      clearPendingStripeCheckoutMarker();
      setIsPurchasingCredit(false);
      setCreditActionMessage('');
      setCreditActionError('Payment not completed. Complete the Stripe payment to add credits.');
    };

    const onPageShow = () => {
      window.setTimeout(handlePossibleAbandonedStripeCheckout, 80);
    };
    const onFocus = () => {
      window.setTimeout(handlePossibleAbandonedStripeCheckout, 80);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      window.setTimeout(handlePossibleAbandonedStripeCheckout, 80);
    };

    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const pending = readPendingStripeCheckoutMarker();
    if (pending && pending.botId === connectedBotId) {
      const isStale = (Date.now() - Number(pending.startedAt || 0)) > STRIPE_PENDING_CHECKOUT_TTL_MS;
      if (isStale) clearPendingStripeCheckoutMarker();
    }
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    flowStep,
    connectedBotId,
    stripeCheckoutStatus,
    stripeSessionId,
    isPurchasingCredit,
    creditActionMessage
  ]);

  const handlePurchaseCredit = async () => {
    if (!connectedBotId || isPurchasingCredit) return;
    const amountUsd = Math.max(0, Math.floor(Number(selectedTopUpUsd || 0)));
    if (!Number.isFinite(amountUsd) || amountUsd < 10) {
      setCreditActionMessage('');
      setCreditActionError('Minimum top up amount is $10.');
      return;
    }
    setCreditActionError('');
    setCreditActionMessage('');
    setIsPurchasingCredit(true);
    let redirecting = false;
    try {
      const response = await fetch(apiUrl(`/bot-credit/${encodeURIComponent(connectedBotId)}/checkout`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountUsd })
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        handleAuthenticationRequired(String(data?.message || data?.error || AUTH_REQUIRED_MESSAGE));
        return;
      }
      if (!response.ok || !data?.success) {
        throw new Error(String(data?.message || data?.error || 'Unable to start secure checkout right now.'));
      }
      const checkoutUrl = String(data?.checkoutUrl || '').trim();
      if (!checkoutUrl) {
        throw new Error('Stripe checkout URL was not returned by the server.');
      }
      try {
        window.sessionStorage.setItem(
          STRIPE_PENDING_CHECKOUT_KEY,
          JSON.stringify({
            botId: connectedBotId,
            amountUsd,
            startedAt: Date.now()
          })
        );
      } catch {}
      setCreditActionMessage('Opening secure Stripe checkout...');
      redirecting = true;
      window.location.href = checkoutUrl;
    } catch (error: any) {
      clearPendingStripeCheckoutMarker();
      setCreditActionError(error?.message || 'Unable to complete recharge right now.');
    } finally {
      if (!redirecting) setIsPurchasingCredit(false);
    }
  };

  const applyDeployResult = (result: any) => {
    const hadTelegramBot = bots.some((b) => b.platform === Platform.TELEGRAM);
    const botId = String(result.botId || '').trim() || Math.random().toString(36).slice(2, 11);
    const botUsername = String(result.botUsername || '').trim();
    const botNameFromTelegram = String(result.botName || '').trim();
    const telegramLink = String(result.telegramLink || '').trim() || (botUsername ? `https://t.me/${botUsername}` : '');
    const botName = botNameFromTelegram || (botUsername ? `@${botUsername}` : `TelegramBot-${bots.length + 1}`);
    const newBot: Bot = {
      id: botId,
      name: botName,
      platform: Platform.TELEGRAM,
      token: token.trim(),
      model: selectedModel,
      status: BotStatus.ACTIVE,
      messageCount: 0,
      tokenUsage: 0,
      lastActive: new Date().toISOString(),
      memoryEnabled: true,
      webhookUrl: result.webhookUrl,
      telegramUsername: botUsername || undefined,
      telegramLink: telegramLink || undefined
    };

    setBots([newBot, ...bots]);
    setConnectedBotId(botId);
    setConnectedBotUsername(botUsername);
    setConnectedBotName(botName);
    setConnectedBotLink(telegramLink);
    setConnectedAiProvider(String(result.aiProvider || ''));
    setConnectedAiModel(String(result.aiModel || ''));
    setShowConnectedToast(true);
    window.setTimeout(() => setShowConnectedToast(false), 4200);
    setIsDeploying(false);
    setDeployStep('input');

    if (hadTelegramBot) {
      setFlowStep('success');
      const params = new URLSearchParams();
      params.set('stage', 'success');
      if (botUsername) params.set('bot', botUsername);
      if (botName) params.set('botName', botName);
      if (botId) params.set('botId', botId);
      navigate(`/connect/telegram?${params.toString()}`, { replace: true, state: location.state });
      return;
    }

    setFlowStep('send-first-message');
  };

  const deployBotWithToken = async (botTokenValue: string, modelValue?: string) => {
    const tokenToUse = String(botTokenValue || '').trim();
    if (!tokenToUse) return;
    setDeployError('');
    setIsDeploying(true);

    try {
      setDeployStep('verifying');
      await new Promise((r) => setTimeout(r, 800));

      setDeployStep('provisioning');
      await new Promise((r) => setTimeout(r, 900));

      setDeployStep('webhooking');
      await new Promise((r) => setTimeout(r, 900));

      const response = await fetch(apiUrl('/deploy-bot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          botToken: tokenToUse,
          model: String(modelValue || selectedModel || '').trim() || selectedModel
        })
      });

      const result = await parseDeployResponse(response);
      if (response.status === 401) {
        handleAuthenticationRequired(formatDeployError(result, response.status));
        throw new Error(AUTH_REQUIRED_MESSAGE);
      }

      if (!response.ok) {
        throw new Error(formatDeployError(result, response.status));
      }

      if (!result.success) {
        throw new Error(formatDeployError(result, response.status));
      }
      applyDeployResult(result);
    } catch (error: any) {
      setIsDeploying(false);
      setDeployStep('input');
      setDeployError(error?.message || 'Unable to connect to backend.');
      throw error;
    }
  };

  const runDemoDeployment = async () => {
    const demoUsername = 'OpenClawDemoBot';
    const demoName = 'OpenClaw Demo';
    const demoBotId = 'demo-bot-preview';
    setDeployError('');
    setFlowNoticeError('');
    setFlowNoticeMessage('Demo Mode: simulating secure deployment flow...');
    setIsDemoModeActive(true);
    setIsDeploying(true);

    try {
      setDeployStep('verifying');
      await new Promise((r) => setTimeout(r, 900));
      setDeployStep('provisioning');
      await new Promise((r) => setTimeout(r, 1000));
      setDeployStep('webhooking');
      await new Promise((r) => setTimeout(r, 1000));

      setConnectedBotId(demoBotId);
      setConnectedBotUsername(demoUsername);
      setConnectedBotName(demoName);
      setConnectedBotLink(`https://t.me/${demoUsername}`);
      setConnectedAiProvider('demo');
      setConnectedAiModel(selectedModel);
      setCreditRemainingUsd(10);
      setCreditDepleted(false);
      setCreditWarning('');
      setIsDeploying(false);
      setDeployStep('input');
      setFlowStep('send-first-message');
      setFlowNoticeMessage('Demo ready. Next, open the bot preview and click "Ready to Connect" to see the final screen.');
    } catch {
      setIsDeploying(false);
      setDeployStep('input');
      setFlowNoticeMessage('');
      setFlowNoticeError('Demo preview could not start. Please try Demo Mode again.');
    }
  };

  const startFirstBotProSubscriptionCheckout = async () => {
    if (!FIRST_BOT_SUBSCRIPTION_ENABLED) {
      if (!token) return;
      await deployBotWithToken(token.trim(), selectedModel);
      return;
    }
    const tokenToUse = token.trim();
    if (!tokenToUse || isStartingProSubscription) return;
    setDeployError('');
    setFlowNoticeError('');
    setFlowNoticeMessage('');
    setIsStartingProSubscription(true);
    let redirecting = false;
    try {
      await validateTokenBeforeSubscription(tokenToUse);

      const response = await fetch(apiUrl('/pro-subscription/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        handleAuthenticationRequired(String(data?.message || data?.error || AUTH_REQUIRED_MESSAGE));
        return;
      }
      if (!response.ok || !data?.success) {
        throw new Error(String(data?.message || data?.error || 'Unable to start Pro subscription checkout right now.'));
      }

      const checkoutUrl = String(data?.checkoutUrl || '').trim();
      if (!checkoutUrl) {
        throw new Error('Stripe subscription checkout URL was not returned by the server.');
      }

      try {
        window.sessionStorage.setItem(
          PRO_SUB_PENDING_DEPLOY_KEY,
          JSON.stringify({
            botToken: tokenToUse,
            model: selectedModel,
            startedAt: Date.now()
          })
        );
        window.sessionStorage.setItem(
          PRO_SUB_PENDING_CHECKOUT_KEY,
          JSON.stringify({ startedAt: Date.now() })
        );
      } catch {}

      redirecting = true;
      window.location.href = checkoutUrl;
    } catch (error: any) {
      clearPendingProSubscriptionCheckoutMarker();
      setFlowNoticeMessage('');
      const message = String(error?.message || 'Unable to start Pro subscription checkout right now.').trim();
      if (/bot token is wrong|already taken|token number/i.test(message)) {
        setDeployError(message);
        setFlowNoticeError('');
      } else {
        setFlowNoticeError(message || 'Unable to start Pro subscription checkout right now.');
      }
    } finally {
      if (!redirecting) setIsStartingProSubscription(false);
    }
  };

  const handleConnect = async () => {
    if (!token) return;
    if (isDemoModeActive) {
      await runDemoDeployment();
      return;
    }
    if (!FIRST_BOT_SUBSCRIPTION_ENABLED) {
      try {
        await deployBotWithToken(token.trim(), selectedModel);
      } catch {
        // Error state is already handled by deployBotWithToken.
      }
      return;
    }
    const hasExistingTelegramBot = bots.some((b) => b.platform === Platform.TELEGRAM);
    if (!hasExistingTelegramBot) {
      await startFirstBotProSubscriptionCheckout();
      return;
    }
    try {
      await deployBotWithToken(token.trim(), selectedModel);
    } catch {
      // Error state is already handled by deployBotWithToken.
    }
  };

  const confirmFirstMessage = async () => {
    setDeployError('');
    setIsDeploying(true);
    setDeployStep('verifying');
    await new Promise((r) => setTimeout(r, 800));

    setDeployStep('provisioning');
    await new Promise((r) => setTimeout(r, 900));

    setDeployStep('webhooking');
    await new Promise((r) => setTimeout(r, 900));

    setIsDeploying(false);
    setDeployStep('input');
    setFlowStep('success');
    const params = new URLSearchParams();
    params.set('stage', 'success');
    if (isDemoModeActive) params.set('demo', '1');
    if (connectedBotUsername) params.set('bot', connectedBotUsername);
    if (connectedBotName) params.set('botName', connectedBotName);
    if (connectedBotId) params.set('botId', connectedBotId);
    const query = `?${params.toString()}`;
    navigate(`/connect/telegram${query}`, { replace: true });
  };

  const displayedCreditUsd =
    creditRemainingUsd !== null && Number.isFinite(creditRemainingUsd)
      ? Math.max(0, Math.floor(creditRemainingUsd))
      : 10;

  const renderSuccessStage = () => {
    const isDemoSuccess = isDemoModeActive || isDemoStage || connectedBotId === 'demo-bot-preview';
    const safeTopUpAmount = Number.isFinite(Number(selectedTopUpUsd)) ? Number(selectedTopUpUsd) : 0;

    return (
      <section className="mx-auto mt-10 max-w-[1120px]">
        <div className="text-center">
          <h2 className="text-[44px] font-[400] tracking-[-0.03em] text-white md:text-[60px]">
            Deploy OpenClaw under 30 seconds
          </h2>
          <p className="mx-auto mt-4 max-w-[760px] text-base leading-8 text-zinc-400 md:text-lg">
            Avoid all technical complexity and one click deploy your own 24/7 active
            <span className="block">OpenClaw instance under 30 seconds.</span>
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-[980px] rounded-[30px] border border-white/10 bg-[#0b0b0c] px-8 py-8 text-center shadow-[0_32px_90px_rgba(0,0,0,0.42)] md:px-14 md:py-10">
          <div className="mx-auto flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-500/12 md:h-20 md:w-20">
            <ICONS.Check className="h-8 w-8 text-emerald-300 md:h-9 md:w-9" />
          </div>
          <h3 className="mt-6 text-3xl font-medium text-white md:text-4xl">Deployment success!</h3>
          <p className="mx-auto mt-3 max-w-[560px] text-base leading-7 text-zinc-400 md:text-lg">
            {isDemoSuccess
              ? 'This is a demo preview. No live billing or bot deployment actions are being executed.'
              : 'Your bot is live. Use your Telegram to chat; usage and credits are below.'}
          </p>

          <div className="mt-9">
            <p className="text-6xl font-[400] tracking-[-0.04em] text-white md:text-7xl">
              ${isCreditLoading ? '...' : displayedCreditUsd}
            </p>
            <p className="mt-3 text-[21px] text-zinc-500 md:text-[24px]">Remaining credits</p>
            <p className="mt-5 text-sm text-zinc-500 md:text-base">
              $0 used today
              <span className="mx-3 text-zinc-700">|</span>
              $0 used this month
              <span className="mx-3 text-zinc-700">|</span>
              Minimum $10 top up
            </p>
          </div>

          <div className="mx-auto mt-8 grid max-w-[700px] gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
            <div>
              <label className="sr-only" htmlFor="success-credit-topup">Credit amount</label>
              <input
                id="success-credit-topup"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={safeTopUpAmount <= 0 ? '' : safeTopUpAmount}
                onChange={(e) => {
                  const nextValue = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
                  setSelectedTopUpUsd(nextValue === '' ? 0 : Number(nextValue));
                  if (creditActionError) setCreditActionError('');
                }}
                className="w-full rounded-[18px] border border-white/10 bg-[#151518] px-5 py-3.5 text-base text-white outline-none focus:border-red-400/25"
                placeholder="Enter amount"
              />
            </div>

            <button
              type="button"
              onClick={handlePurchaseCredit}
              disabled={isPurchasingCredit || !connectedBotId || isDemoSuccess}
              className="rounded-[18px] bg-[#e7e7e8] px-5 py-3.5 text-base font-medium text-[#111111] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDemoSuccess ? 'Demo preview only' : (isPurchasingCredit ? 'Processing...' : 'Purchase credit ->')}
            </button>
          </div>

          <p className="mt-4 text-sm text-zinc-500">
            One time purchase. 10% is charged as processing fees.
          </p>

          {creditActionMessage ? (
            <div className="mx-auto mt-5 max-w-[640px] rounded-[18px] border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
              {creditActionMessage}
            </div>
          ) : null}
          {creditActionError ? (
            <div className="mx-auto mt-5 max-w-[640px] rounded-[18px] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {creditActionError}
            </div>
          ) : null}
          {creditDepleted ? (
            <div className="mx-auto mt-5 max-w-[640px] rounded-[18px] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
              Recharge is required before the bot can continue processing messages.
              {creditWarning ? <div className="mt-2 text-red-200/85">{creditWarning}</div> : null}
            </div>
          ) : null}

          <p className="mt-8 text-sm text-zinc-500 md:text-base">
            Too slow or memory issues?{' '}
            <a href="/contact" className="border-b border-white/20 pb-0.5 text-zinc-200">
              Contact
            </a>
          </p>
        </div>
      </section>
    );
  };

  const renderFlowCard = () => {
    if (flowStep === 'send-first-message') {
      return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold text-white">Open your bot in Telegram</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Send the first message so SwiftDeploy can confirm the connection and open the command center.
            </p>
          </div>
          {isDemoModeActive ? (
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-100 font-medium">
              Demo preview is active. No real bot will be connected.
            </div>
          ) : null}
          {flowNoticeMessage ? (
            <div className="rounded-[22px] border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100 font-medium">
              {flowNoticeMessage}
            </div>
          ) : null}
          {flowNoticeError ? (
            <div className="rounded-[22px] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200 font-medium">
              {flowNoticeError}
            </div>
          ) : null}
          <ul className="space-y-3">
            <li className="rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-6 text-zinc-300">
              1. Open your bot in Telegram ({connectedBotUsername ? `@${connectedBotUsername}` : 'from BotFather'}).
            </li>
            <li className="rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-6 text-zinc-300">
              2. Send <code className="rounded bg-zinc-800 px-2 py-1 text-xs font-mono text-zinc-200">/start</code> to activate the conversation.
            </li>
            <li className="rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4 text-sm leading-6 text-zinc-300">
              3. Click the button below after the first message is sent.
            </li>
          </ul>
          {connectedBotLink ? (
            <a
              href={isDemoModeActive ? 'https://t.me/BotFather' : connectedBotLink}
              target="_blank"
              rel="noreferrer"
              className="block rounded-full border border-white/8 bg-white/[0.03] py-3 text-center text-sm text-white transition-colors hover:bg-white/[0.06]"
            >
              {isDemoModeActive ? 'Open BotFather (Demo Preview)' : `Open @${connectedBotUsername || 'your_bot'} in Telegram`}
            </a>
          ) : null}
          <button
            onClick={confirmFirstMessage}
            disabled={isDeploying}
            className="w-full btn-deploy-gradient rounded-full py-3.5 text-base font-medium text-white transition-all"
          >
            Ready to Connect
          </button>
        </div>
      );
    }

    return (
      <>
        <div className="mb-12">
          <h2 className="mb-5 text-2xl font-semibold text-white">Telegram setup</h2>
          <ul className="space-y-3">
            {[
              <>Open Telegram and go to <a href="https://t.me/BotFather" target="_blank" className="text-white border-b border-zinc-700 hover:border-white font-bold transition-all">@BotFather</a>.</>,
              <>Start a chat and type <code className="bg-zinc-800 text-zinc-200 px-2 py-1 rounded text-xs font-mono">/newbot</code>.</>,
              <>Follow the prompts to name your bot and choose a username.</>,
              <>BotFather will send you a message with your bot token. Copy the entire token.</>,
              <>Paste the token below and click Save & Connect.</>,
              <>SwiftDeploy will verify token, configure webhook, and connect the same BotFather bot (it does not create a new bot name).</>
            ].map((step, i) => (
              <li key={i} className="flex gap-4 rounded-[22px] border border-white/8 bg-[#111114] px-4 py-4 text-sm font-medium leading-relaxed text-zinc-300">
                <span className="shrink-0 text-red-100">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-6">
          {flowNoticeMessage ? (
            <div className="rounded-[22px] border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100 font-medium">
              {flowNoticeMessage}
            </div>
          ) : null}
          {flowNoticeError ? (
            <div className="rounded-[22px] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200 font-medium">
              {flowNoticeError}
            </div>
          ) : null}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-sm text-zinc-400">Bot token</label>
              <button onClick={generateDemoToken} className="text-xs text-zinc-300 transition-colors hover:text-zinc-100">
                Demo Mode
              </button>
            </div>
            <div className="relative">
              <div className="absolute left-6 top-1/2 -translate-y-1/2">
                <svg className="w-5 h-5 text-zinc-700" fill="currentColor" viewBox="0 0 24 24"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
              </div>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="34567890:ABCdefGHIjklMNOpqrSTUVwxyz"
                className="w-full rounded-[24px] border border-white/8 bg-[#111114] pl-16 pr-6 py-4 text-sm text-white outline-none transition-colors focus:border-red-400/25 placeholder:text-zinc-700"
              />
            </div>
          </div>

          {deployError ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
              Deployment failed: {deployError}
            </div>
          ) : null}

          <button
            onClick={handleConnect}
            disabled={!token || isDeploying || isStartingProSubscription}
            className="w-full btn-deploy-gradient flex items-center justify-center gap-3 rounded-full py-3.5 text-base font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save & Connect <ICONS.Check className="w-5 h-5 text-zinc-500 group-hover:text-white transition-colors" />
          </button>
        </div>
      </>
    );
  };

  return (
    <>
      <Seo
        title="Connect Telegram Bot | SwiftDeploy"
        description="Provisioning flow for connecting a Telegram bot to SwiftDeploy."
        path="/connect/telegram"
        noindex
      />
      <MarketingShell ctaLabel="Contact Support" ctaHref="/contact">
        {flowStep !== 'success' ? (
          <section className="pt-8 text-center md:pt-12">
            <h1 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
              Connect Telegram in one guided flow
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
              Short steps, one main card, and a clean preview on the right.
            </p>
          </section>
        ) : null}

        {flowStep === 'success' ? renderSuccessStage() : (
          <div className="relative mx-auto mt-10 max-w-[920px]">
            {isDeploying ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[30px] bg-black/70 backdrop-blur-sm">
                <div className="rounded-[28px] border border-white/10 bg-[#0b0b0c] px-8 py-7 text-center shadow-[0_25px_70px_rgba(0,0,0,0.45)]">
                  <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-red-400" />
                  <p className="mt-5 text-base font-medium text-white">
                    {deployStep === 'verifying'
                      ? 'Verifying token'
                      : deployStep === 'provisioning'
                        ? 'Starting deployment'
                        : 'Pairing Telegram webhook'}
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">Do not switch tabs. This usually finishes in a few seconds.</p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
              <section className="rounded-[30px] border border-white/10 bg-[#0b0b0c] p-6 md:p-8">
                <div className="mb-8 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03]">
                      <ICONS.Telegram className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-lg font-medium text-white">Telegram connection</p>
                      <p className="text-sm text-zinc-500">
                        Short steps, clearer text, and a wider setup area.
                      </p>
                    </div>
                  </div>
                  {(isDemoModeActive || isDemoStage) ? (
                    <div className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1 text-xs text-red-100">
                      Demo mode
                    </div>
                  ) : null}
                </div>
                {renderFlowCard()}
              </section>

              <aside className="space-y-6">
                <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[#0b0b0c]">
                  <div className="border-b border-white/8 px-5 py-4">
                    <p className="text-sm font-medium text-white">Setup preview</p>
                    <p className="text-xs text-zinc-500">A wide walkthrough instead of the narrow phone mockup.</p>
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
                        <source src="/videos/demo.mp4" type="video/mp4" />
                        <source src="/videos/telegram-token-tutorial.mp4" type="video/mp4" />
                        <source src="/videos/telegram-token-tutorial.webm" type="video/webm" />
                        Your browser does not support the video tag.
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
                      <p className="text-sm text-zinc-400">Video preview failed to load. You can still continue with the setup steps on the left.</p>
                      <a
                        href="/videos/demo.mp4"
                        target="_blank"
                        rel="noreferrer"
                        className="btn-deploy-gradient mt-4 inline-flex rounded-full px-4 py-2 text-sm font-medium"
                      >
                        Open demo video
                      </a>
                    </div>
                  )}
                </div>

                <div className="rounded-[30px] border border-white/10 bg-[#0b0b0c] p-5">
                  <p className="text-sm font-medium text-white">What happens next</p>
                  <div className="mt-4 space-y-3">
                    {[
                      'SwiftDeploy verifies the token and sets up the webhook.',
                      'The bot is added to your workspace without changing the BotFather name.',
                      'After the first Telegram message, the dashboard opens with credits and quick actions.'
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
        )}

        {showConnectedToast ? (
          <div className="fixed bottom-6 right-6 z-[120] max-w-[380px] rounded-[24px] border border-emerald-400/35 bg-emerald-500/15 px-5 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-emerald-400/50 bg-emerald-500/25">
                <ICONS.Check className="h-4 w-4 text-emerald-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-100">Telegram connected</p>
                <p className="mt-1 text-xs text-emerald-100/85">
                  {connectedBotUsername ? `Connected to @${connectedBotUsername}.` : 'Your bot token is now linked.'}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </MarketingShell>
    </>
  );
};

export default ConnectTelegram;


