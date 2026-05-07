/**
 * WebForge SMS — Twilio-backed SMS sending for phone verification.
 *
 * Required environment variables:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_PHONE_NUMBER  (e.g. +15551234567)
 */

import { logger } from "./logger";

const ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"] ?? "";
const AUTH_TOKEN = process.env["TWILIO_AUTH_TOKEN"] ?? "";
const FROM_NUMBER = process.env["TWILIO_PHONE_NUMBER"] ?? "";

export const SMS_CONFIGURED = Boolean(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER);

export class SMSError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "SMSError";
    this.status = status;
  }
}

/**
 * Send an SMS message via Twilio REST API.
 */
export async function sendSMS(to: string, body: string): Promise<void> {
  if (!SMS_CONFIGURED) {
    throw new SMSError(
      "SMS not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER",
    );
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({
    To: to,
    From: FROM_NUMBER,
    Body: body,
  });

  const credentials = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text.slice(0, 300) }, "Twilio SMS failed");
    throw new SMSError(
      `SMS send failed (${res.status}): ${text.slice(0, 200)}`,
      res.status,
    );
  }
}

/**
 * Generate a secure 6-digit OTP code.
 */
export function generateOTPCode(): string {
  const crypto = require("crypto") as typeof import("crypto");
  const bytes = crypto.randomBytes(4);
  const num = bytes.readUInt32BE(0) % 1_000_000;
  return String(num).padStart(6, "0");
}

/**
 * Normalize a phone number to E.164 format (basic normalization).
 * Caller is responsible for full validation.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  return digits.startsWith("1") ? `+${digits}` : `+${digits}`;
}
