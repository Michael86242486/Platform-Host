/**
 * WebForge Email OTP — Resend-backed email verification.
 *
 * Uses Resend's free tier (3,000 emails/month, 100/day — no credit card).
 * Get a free API key at https://resend.com
 *
 * Required environment variable:
 *   RESEND_API_KEY  — your Resend API key (starts with "re_")
 *
 * Optional:
 *   EMAIL_FROM  — sender address (default: onboarding@resend.dev works on free plan)
 */

import crypto from "node:crypto";
import { logger } from "./logger";

const RESEND_API_KEY = process.env["RESEND_API_KEY"] ?? "";
const EMAIL_FROM = process.env["EMAIL_FROM"] ?? "WebForge <onboarding@resend.dev>";
const RESEND_API = "https://api.resend.com/emails";

export const EMAIL_OTP_CONFIGURED = Boolean(RESEND_API_KEY);

export class EmailOTPError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "EmailOTPError";
    this.status = status;
  }
}

/**
 * Generate a secure 6-digit OTP code.
 */
export function generateOTPCode(): string {
  const bytes = crypto.randomBytes(4);
  const num = bytes.readUInt32BE(0) % 1_000_000;
  return String(num).padStart(6, "0");
}

/**
 * Validate an email address (basic sanity check).
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Send a 6-digit OTP to the given email address via Resend.
 */
export async function sendEmailOTP(to: string, code: string): Promise<void> {
  if (!EMAIL_OTP_CONFIGURED) {
    throw new EmailOTPError(
      "Email OTP not configured — add RESEND_API_KEY (free at resend.com)",
    );
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #fff; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto;">
    <div style="margin-bottom: 32px;">
      <span style="font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">⚡ WebForge</span>
    </div>
    <h1 style="font-size: 28px; font-weight: 700; margin: 0 0 12px; letter-spacing: -0.5px;">Your verification code</h1>
    <p style="color: #888; font-size: 15px; margin: 0 0 32px; line-height: 1.6;">
      Use the code below to verify your email and sign in to WebForge AI.
      It expires in <strong style="color: #fff;">10 minutes</strong>.
    </p>
    <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 28px; text-align: center; margin-bottom: 32px;">
      <div style="font-size: 42px; font-weight: 800; letter-spacing: 12px; font-family: 'Courier New', monospace; color: #fff;">
        ${code}
      </div>
    </div>
    <p style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
      If you didn't request this, you can safely ignore this email.
      Someone may have typed your address by mistake.
    </p>
  </div>
</body>
</html>`;

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject: `${code} — your WebForge verification code`,
      html,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text.slice(0, 300) }, "Resend email failed");
    throw new EmailOTPError(
      `Email send failed (${res.status}): ${text.slice(0, 200)}`,
      res.status,
    );
  }

  logger.info({ to: to.replace(/(?<=.{3}).(?=.*@)/g, "*") }, "Email OTP sent");
}
