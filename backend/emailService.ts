import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { resolve4 } from 'dns/promises';

// Load environment variables in the email service as well
dotenv.config();

const OTP_EXPIRES_MS = 10 * 60 * 1000;
const OTP_MAX_FAILED_ATTEMPTS = 5;
const DEV_OTP_FALLBACK_ENABLED = process.env.ENABLE_DEV_OTP_FALLBACK === 'true';
const IS_PRODUCTION = (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
// In production we require real email delivery and disable in-app OTP fallback.
const OTP_IN_APP_FALLBACK_ENABLED = !IS_PRODUCTION && (process.env.OTP_IN_APP_FALLBACK_ENABLED || 'true').trim().toLowerCase() === 'true';
const OTP_SKIP_SMTP_WHEN_FALLBACK = OTP_IN_APP_FALLBACK_ENABLED && (process.env.OTP_SKIP_SMTP_WHEN_FALLBACK || 'false').trim().toLowerCase() === 'true';

type OtpRecord = {
  codeHash: Buffer;
  expiresAt: Date;
  failedAttempts: number;
};

// In-memory storage for verification codes (in production, use a proper database)
const verificationCodes = new Map<string, OtpRecord>();
const devPlainCodes = new Map<string, string>();

// In-memory storage for registered users with password hashes (in production, use a proper database)
type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
};
const registeredUsers = new Map<string, User>(); // Store registered users with their password hashes
const pendingSignups = new Map<string, { id: string; email: string; name: string; passwordHash: string; createdAt: Date }>();

const SMTP_CONNECTION_TIMEOUT_MS = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 6000);
const SMTP_GREETING_TIMEOUT_MS = Number(process.env.SMTP_GREETING_TIMEOUT_MS || 6000);
const SMTP_SOCKET_TIMEOUT_MS = Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 8000);
const SMTP_FORCE_IPV4 = (process.env.SMTP_FORCE_IPV4 || 'true').trim().toLowerCase() !== 'false';
const SMTP_DNS_TIMEOUT_MS = Number(process.env.SMTP_DNS_TIMEOUT_MS || 1200);
const SMTP_SEND_TIMEOUT_MS = Number(process.env.SMTP_SEND_TIMEOUT_MS || 7000);
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const RESEND_API_BASE_URL = String(process.env.RESEND_API_BASE_URL || 'https://api.resend.com').trim().replace(/\/+$/, '');
const RESEND_SEND_TIMEOUT_MS = Number(process.env.RESEND_SEND_TIMEOUT_MS || 8000);
const RESEND_FROM = String(process.env.RESEND_FROM || process.env.EMAIL_FROM || '').trim();
const RESEND_REPLY_TO = String(process.env.RESEND_REPLY_TO || '').trim();

const hasResendProvider = (): boolean => RESEND_API_KEY.length > 0;
const hasSmtpProvider = (): boolean => String(process.env.SMTP_USER || '').trim().length > 0 && String(process.env.SMTP_PASS || '').trim().length > 0;

const normalizeAddressList = (input: unknown): string[] => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.flatMap((entry) => normalizeAddressList(entry));
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (typeof input === 'object' && input !== null && 'address' in input) {
    const maybeAddress = String((input as any).address || '').trim();
    return maybeAddress ? [maybeAddress] : [];
  }
  return [];
};

const normalizeSingleAddress = (input: unknown): string => {
  const values = normalizeAddressList(input);
  return values[0] || '';
};

const sendMailViaResend = async (mailOptions: nodemailer.SendMailOptions): Promise<{ ok: true } | { ok: false; error: any }> => {
  if (!hasResendProvider()) {
    return { ok: false, error: Object.assign(new Error('RESEND_NOT_CONFIGURED'), { code: 'RESEND_NOT_CONFIGURED' }) };
  }

  const from = normalizeSingleAddress(mailOptions.from) || RESEND_FROM || String(process.env.EMAIL_FROM || '').trim() || String(process.env.SMTP_USER || '').trim();
  const to = normalizeAddressList(mailOptions.to);
  const subject = String(mailOptions.subject || '').trim();
  const html = typeof mailOptions.html === 'string' ? mailOptions.html : undefined;
  const text = typeof mailOptions.text === 'string' ? mailOptions.text : undefined;

  if (!from) {
    return { ok: false, error: Object.assign(new Error('RESEND_FROM_MISSING'), { code: 'RESEND_FROM_MISSING' }) };
  }
  if (!to.length) {
    return { ok: false, error: Object.assign(new Error('RESEND_RECIPIENT_MISSING'), { code: 'RESEND_RECIPIENT_MISSING' }) };
  }
  if (!subject) {
    return { ok: false, error: Object.assign(new Error('RESEND_SUBJECT_MISSING'), { code: 'RESEND_SUBJECT_MISSING' }) };
  }

  const payload: Record<string, unknown> = {
    from,
    to,
    subject
  };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (RESEND_REPLY_TO) payload.reply_to = RESEND_REPLY_TO;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEND_SEND_TIMEOUT_MS);

  try {
    const response = await fetch(`${RESEND_API_BASE_URL}/emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      const message = raw || `RESEND_HTTP_${response.status}`;
      return {
        ok: false,
        error: Object.assign(new Error(message), { code: `RESEND_HTTP_${response.status}`, status: response.status })
      };
    }

    return { ok: true };
  } catch (error) {
    const err = error as any;
    if (err?.name === 'AbortError') {
      return { ok: false, error: Object.assign(new Error('RESEND_TIMEOUT'), { code: 'RESEND_TIMEOUT' }) };
    }
    return { ok: false, error: Object.assign(new Error(String(err?.message || 'RESEND_SEND_FAILED')), { code: err?.code || 'RESEND_SEND_FAILED' }) };
  } finally {
    clearTimeout(timeout);
  }
};

type SmtpCandidate = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  label: string;
};

const buildSmtpCandidates = (host: string, configuredPort: number): SmtpCandidate[] => {
  const normalizedHost = host.trim().toLowerCase();
  const candidates: SmtpCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidate: SmtpCandidate) => {
    const key = `${candidate.host}|${candidate.port}|${candidate.secure ? '1' : '0'}|${candidate.requireTLS ? '1' : '0'}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  pushCandidate({
    host,
    port: configuredPort,
    secure: configuredPort === 465,
    requireTLS: configuredPort !== 465 ? true : undefined,
    label: 'configured'
  });

  // Gmail-specific fallback ports (helps when one route is blocked by provider/network)
  if (normalizedHost.includes('gmail.com')) {
    pushCandidate({ host, port: 465, secure: true, label: 'gmail-ssl' });
    pushCandidate({ host, port: 587, secure: false, requireTLS: true, label: 'gmail-starttls' });
  }

  return candidates;
};

const createTransportFromCandidate = (
  smtpUser: string,
  smtpPass: string,
  candidate: SmtpCandidate,
  effectiveHost?: string,
  tlsServername?: string
) => {
  return nodemailer.createTransport({
    host: effectiveHost || candidate.host,
    port: candidate.port,
    secure: candidate.secure,
    requireTLS: candidate.requireTLS,
    auth: {
      user: smtpUser,
      pass: smtpPass
    },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
      servername: tlsServername
    }
  } as any);
};

const resolve4WithTimeout = async (host: string, timeoutMs: number): Promise<string[]> => {
  const timeoutPromise = new Promise<string[]>((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error('DNS resolve timeout'), { code: 'DNS_TIMEOUT' })), timeoutMs);
  });
  return Promise.race([resolve4(host), timeoutPromise]);
};

const sendMailWithTimeout = async (
  transporter: nodemailer.Transporter,
  mailOptions: nodemailer.SendMailOptions,
  timeoutMs: number
) => {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error('SMTP send timeout'), { code: 'SMTP_SEND_TIMEOUT' })), timeoutMs);
  });
  return Promise.race([transporter.sendMail(mailOptions), timeoutPromise]);
};

const sendMailWithFallback = async (mailOptions: nodemailer.SendMailOptions): Promise<{ ok: true } | { ok: false; error: any }> => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);

  if (!smtpUser || !smtpPass) {
    return { ok: false, error: Object.assign(new Error('SMTP_NOT_CONFIGURED'), { code: 'SMTP_NOT_CONFIGURED' }) };
  }

  const candidates = buildSmtpCandidates(smtpHost, smtpPort);
  let lastError: any = null;

  for (const candidate of candidates) {
    try {
      let effectiveHost = candidate.host;
      let tlsServername: string | undefined;
      if (SMTP_FORCE_IPV4) {
        try {
          const resolved = await resolve4WithTimeout(candidate.host, SMTP_DNS_TIMEOUT_MS);
          if (Array.isArray(resolved) && resolved.length > 0) {
            effectiveHost = resolved[0];
            tlsServername = candidate.host;
          }
        } catch (resolveError) {
          const resolveCode = String((resolveError as any)?.code || 'UNKNOWN');
          const resolveMessage = String((resolveError as any)?.message || 'No resolve message');
          console.error(`[EMAIL] IPv4 resolve failed for ${candidate.host}: ${resolveCode} ${resolveMessage}`);
        }
      }

      const transporter = createTransportFromCandidate(smtpUser, smtpPass, candidate, effectiveHost, tlsServername);
      await sendMailWithTimeout(transporter, mailOptions, SMTP_SEND_TIMEOUT_MS);
      return { ok: true };
    } catch (error) {
      lastError = error;
      const err = error as any;
      const errCode = String(err?.code || 'UNKNOWN');
      const errMessage = String(err?.message || 'No error message');
      console.error(`[EMAIL] SMTP send failed via ${candidate.label} (${candidate.host}:${candidate.port}, secure=${candidate.secure ? 'true' : 'false'}): ${errCode} ${errMessage}`);
    }
  }

  return { ok: false, error: lastError || Object.assign(new Error('SMTP_SEND_FAILED'), { code: 'SMTP_SEND_FAILED' }) };
};

const sendMailWithProviderFallback = async (mailOptions: nodemailer.SendMailOptions): Promise<{ ok: true } | { ok: false; error: any }> => {
  let primaryError: any = null;

  if (hasResendProvider()) {
    const resendDelivery = await sendMailViaResend(mailOptions);
    if (resendDelivery.ok) {
      return resendDelivery;
    }
    primaryError = resendDelivery.error;
    const code = String(primaryError?.code || 'UNKNOWN');
    const message = String(primaryError?.message || 'No error message');
    console.error(`[EMAIL] Resend send failed: ${code} ${message}`);
  }

  if (hasSmtpProvider()) {
    const smtpDelivery = await sendMailWithFallback(mailOptions);
    if (smtpDelivery.ok) {
      return smtpDelivery;
    }
    if (!primaryError) {
      primaryError = smtpDelivery.error;
    }
    return { ok: false, error: primaryError || smtpDelivery.error };
  }

  if (primaryError) {
    return { ok: false, error: primaryError };
  }

  return { ok: false, error: Object.assign(new Error('EMAIL_NOT_CONFIGURED'), { code: 'EMAIL_NOT_CONFIGURED' }) };
};

// Generate 6-digit verification code
const generateVerificationCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store verification code with 10-minute expiry
const storeVerificationCode = (email: string, code: string): void => {
  const normalizedEmail = email.toLowerCase();
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MS);
  const codeHash = crypto.createHash('sha256').update(code).digest();
  verificationCodes.set(normalizedEmail, { codeHash, expiresAt, failedAttempts: 0 });
  if (process.env.NODE_ENV !== 'production' || OTP_IN_APP_FALLBACK_ENABLED) {
    devPlainCodes.set(normalizedEmail, code);
  }
};

// Validate verification code
export const validateVerificationCode = (email: string, code: string): { ok: boolean; reason?: 'missing' | 'expired' | 'attempts_exceeded' | 'invalid' } => {
  const normalizedEmail = email.toLowerCase();
  const stored = verificationCodes.get(normalizedEmail);
  
  if (!stored) {
    return { ok: false, reason: 'missing' };
  }
  
  if (new Date() > stored.expiresAt) {
    verificationCodes.delete(normalizedEmail); // Clean up expired code
    pendingSignups.delete(normalizedEmail);
    return { ok: false, reason: 'expired' };
  }

  if (stored.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
    verificationCodes.delete(normalizedEmail);
    pendingSignups.delete(normalizedEmail);
    return { ok: false, reason: 'attempts_exceeded' };
  }
  
  const providedHash = crypto.createHash('sha256').update(code).digest();
  const isValid = providedHash.length === stored.codeHash.length && crypto.timingSafeEqual(providedHash, stored.codeHash);
  
  if (isValid) {
    verificationCodes.delete(normalizedEmail); // Remove used code
    devPlainCodes.delete(normalizedEmail);
    return { ok: true };
  }
  
  stored.failedAttempts += 1;
  if (stored.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
    verificationCodes.delete(normalizedEmail);
    pendingSignups.delete(normalizedEmail);
    devPlainCodes.delete(normalizedEmail);
  } else {
    verificationCodes.set(normalizedEmail, stored);
  }

  return { ok: false, reason: stored.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS ? 'attempts_exceeded' : 'invalid' };
};

// Check if email is already registered
export const isEmailRegistered = (email: string): boolean => {
  return registeredUsers.has(email.toLowerCase());
};

// Mark email as registered
export const markEmailAsRegistered = (email: string, name: string, passwordHash: string): User => {
  const normalizedEmail = email.toLowerCase();
  const user: User = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    name,
    passwordHash
  };
  registeredUsers.set(normalizedEmail, user);
  pendingSignups.delete(normalizedEmail);
  return user;
};

// Get user by email
export const getUserByEmail = (email: string): User | undefined => {
  return registeredUsers.get(email.toLowerCase());
};

// Update password hash for user
export const updateUserPassword = (email: string, newPasswordHash: string): void => {
  const user = registeredUsers.get(email.toLowerCase());
  if (user) {
    registeredUsers.set(email.toLowerCase(), {
      ...user,
      passwordHash: newPasswordHash
    });
  }
};

export const storePendingSignup = (email: string, name: string, passwordHash: string): void => {
  const normalizedEmail = email.toLowerCase();
  pendingSignups.set(normalizedEmail, {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    name,
    passwordHash,
    createdAt: new Date()
  });
};

export const getPendingSignup = (email: string): { id: string; email: string; name: string; passwordHash: string; createdAt: Date } | undefined => {
  return pendingSignups.get(email.toLowerCase());
};

export const clearPendingSignup = (email: string): void => {
  pendingSignups.delete(email.toLowerCase());
};

export const clearVerificationState = (email: string): void => {
  const normalizedEmail = email.toLowerCase();
  verificationCodes.delete(normalizedEmail);
  devPlainCodes.delete(normalizedEmail);
};

export const getDevVerificationCode = (email: string): string | undefined => {
  if (process.env.NODE_ENV === 'production' && !OTP_IN_APP_FALLBACK_ENABLED) {
    return undefined;
  }
  return devPlainCodes.get(email.toLowerCase());
};

export type VerificationSendResult = {
  success: boolean;
  message: string;
  statusCode?: number;
  devCode?: string;
};

// Send verification email
export const sendVerificationEmail = async (email: string, name: string): Promise<VerificationSendResult> => {
  try {
    const code = generateVerificationCode();
    storeVerificationCode(email, code);
    const fallbackCode = getDevVerificationCode(email);

    // Fast path: avoid SMTP/network delays when in-app OTP fallback is enabled.
    const onlySmtpAvailable = !hasResendProvider() && hasSmtpProvider();
    if (OTP_IN_APP_FALLBACK_ENABLED && OTP_SKIP_SMTP_WHEN_FALLBACK && onlySmtpAvailable) {
      if (fallbackCode) {
        console.warn(`[OTP_FAST_FALLBACK] ${email}: skipping SMTP and issuing in-app OTP.`);
        return { success: true, message: 'OTP generated in-app. Continue verification.', devCode: fallbackCode };
      }
    }

    const emailFrom = RESEND_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER;
    if (!emailFrom) {
      if ((!IS_PRODUCTION && DEV_OTP_FALLBACK_ENABLED) || fallbackCode) {
        return { success: true, message: 'OTP generated in-app. Continue verification.', devCode: fallbackCode || code };
      }
      clearVerificationState(email);
      return { success: false, statusCode: 500, message: 'Email sender is not configured. Contact support.' };
    }

    const mailOptions = {
      from: emailFrom,  // Use the fallback value
      to: email,
      subject: 'SwiftDeploy - Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">SwiftDeploy</h1>
            <p style="color: #bfdbfe; margin: 10px 0 0 0; font-size: 16px;">AI Bot Deployment Platform</p>
          </div>
          
          <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #1e293b; margin-top: 0;">Hello ${name}!</h2>
            
            <p style="color: #64748b; line-height: 1.6; margin: 20px 0;">
              Welcome to SwiftDeploy! Please use the verification code below to complete your account setup.
            </p>
            
            <div style="background: white; border: 2px dashed #3b82f6; border-radius: 8px; padding: 25px; text-align: center; margin: 30px 0;">
              <p style="color: #64748b; margin: 0 0 10px 0; font-size: 14px;">Your Verification Code</p>
              <h2 style="color: #1e40af; font-size: 36px; letter-spacing: 8px; margin: 0; font-weight: bold;">${code}</h2>
            </div>
            
            <p style="color: #64748b; line-height: 1.6; margin: 20px 0;">
              This code will expire in 10 minutes. If you didn't request this verification, please ignore this email.
            </p>
            
            <div style="background: #f1f5f9; padding: 20px; border-radius: 8px; margin-top: 30px;">
              <p style="color: #64748b; margin: 0; font-size: 14px;">
                <strong>Need help?</strong> Contact our support team at ops@swiftdeploy.ai
              </p>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #94a3b8; font-size: 12px;">
            <p>© 2025 SwiftDeploy Operations Group LLC. All rights reserved.</p>
          </div>
        </div>
      `
    };

    const delivery = await sendMailWithProviderFallback(mailOptions);
    if (!delivery.ok) {
      throw delivery.error;
    }

    return { success: true, statusCode: 200, message: 'OTP sent to your email address' };
  } catch (error) {
    if (!IS_PRODUCTION && DEV_OTP_FALLBACK_ENABLED) {
      const fallbackCode = getDevVerificationCode(email);
      if (fallbackCode) {
        console.log(`[DEV_OTP_FALLBACK] ${email}: ${fallbackCode}`);
        return { success: true, message: 'OTP generated in local mode', devCode: fallbackCode };
      }
    }

    const fallbackCode = !IS_PRODUCTION ? getDevVerificationCode(email) : undefined;
    if (!IS_PRODUCTION && fallbackCode) {
      console.warn(`[OTP_IN_APP_FALLBACK] ${email}: SMTP delivery failed, using in-app verification code.`);
      return { success: true, message: 'Email delivery delayed. OTP generated in-app.', devCode: fallbackCode };
    }

    clearVerificationState(email);
    const err = error as any;
    const code = typeof err?.code === 'string' ? err.code : '';
    const responseCode = Number(err?.responseCode || 0);
    const responseText = String(err?.response || err?.message || '').toLowerCase();
    if (
      code === 'EENVELOPE'
      || responseCode === 550
      || responseCode === 551
      || responseCode === 553
      || responseCode === 554
      || responseText.includes('user unknown')
      || responseText.includes('no such user')
      || responseText.includes('mailbox unavailable')
      || responseText.includes('recipient address rejected')
    ) {
      return { success: false, statusCode: 400, message: 'This email address looks invalid or cannot receive mail. Please enter a real email address.' };
    }
    if (code === 'EAUTH') {
      return { success: false, statusCode: 500, message: 'Email delivery service is temporarily unavailable. Please try again shortly.' };
    }
    if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET') {
      return { success: false, statusCode: 503, message: 'Unable to connect to email server. Please try again shortly.' };
    }
    return { success: false, statusCode: 500, message: 'Failed to deliver verification email. Please try again.' };
  }
};

// Send test email
export const sendTestEmail = async (email: string): Promise<boolean> => {
  try {
    const emailFrom = RESEND_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER;
    if (!emailFrom) return false;
    
    const mailOptions = {
      from: emailFrom,
      to: email,
      subject: 'SwiftDeploy - Test Email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #34d399 100%); padding: 30px; text-align: center; border-radius: 10px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">✅ Email Test Successful!</h1>
            <p style="color: #d1fae5; margin: 10px 0 0 0; font-size: 16px;">SwiftDeploy Email System is Working</p>
          </div>
          
          <div style="background: #f0fdf4; padding: 30px; border: 1px solid #bbf7d0; border-top: none; border-radius: 0 0 10px 10px; margin-top: 20px;">
            <h2 style="color: #065f46; margin-top: 0;">Test Email Confirmation</h2>
            
            <p style="color: #065f46; line-height: 1.6; margin: 20px 0;">
              This is a test email from SwiftDeploy to confirm that your email configuration is working properly.
            </p>
            
            <div style="background: white; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="color: #065f46; margin: 0; font-size: 14px;">
                <strong>Configuration Status:</strong> ✅ Active
              </p>
              <p style="color: #065f46; margin: 5px 0 0 0; font-size: 14px;">
                <strong>Timestamp:</strong> ${new Date().toISOString()}
              </p>
            </div>
          </div>
        </div>
      `
    };

    const delivery = await sendMailWithProviderFallback(mailOptions);
    if (!delivery.ok) {
      return false;
    }
    
    return true;
  } catch (error) {
    return false;
  }
};

// Get pending verification codes (for debugging)
export const getPendingVerifications = (): Array<{email: string, expiresAt: string}> => {
  return Array.from(verificationCodes.entries()).map(([email, data]) => ({
    email,
    expiresAt: data.expiresAt.toISOString()
  }));
};
