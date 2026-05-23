/**
 * Email transport: SMTP (nodemailer) or Postmark (HTTPS API).
 *
 * Mirrors the Python API's transport pattern — selected at startup via
 * EMAIL_TRANSPORT config. SMTP is used in dev (MailHog on port 1025),
 * Postmark in production.
 */

import { createTransport, type Transporter } from 'nodemailer';

import { getConfig } from '../config.js';
import { logger } from '../log.js';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

let cachedTransport: Transporter | null = null;

function getSmtpTransport(): Transporter {
  if (cachedTransport !== null) return cachedTransport;
  const cfg = getConfig();
  cachedTransport = createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: false,
  });
  return cachedTransport;
}

async function sendViaSmtp(msg: EmailMessage): Promise<void> {
  const cfg = getConfig();
  const transport = getSmtpTransport();
  await transport.sendMail({
    from: cfg.SMTP_FROM,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

async function sendViaPostmark(msg: EmailMessage): Promise<void> {
  const cfg = getConfig();
  const token = cfg.POSTMARK_SERVER_TOKEN;
  if (!token) {
    throw new Error('POSTMARK_SERVER_TOKEN is required when EMAIL_TRANSPORT=postmark');
  }
  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: cfg.SMTP_FROM,
      To: msg.to,
      Subject: msg.subject,
      TextBody: msg.text,
      HtmlBody: msg.html,
      MessageStream: 'outbound',
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Postmark API returned ${response.status}: ${body.slice(0, 300)}`);
  }
}

export async function deliverEmail(msg: EmailMessage): Promise<void> {
  const cfg = getConfig();
  const transport = cfg.EMAIL_TRANSPORT;
  logger.debug({ to: msg.to, subject: msg.subject, transport }, 'delivering email');

  if (transport === 'postmark') {
    await sendViaPostmark(msg);
  } else {
    await sendViaSmtp(msg);
  }

  logger.info({ to: msg.to, subject: msg.subject }, 'email delivered');
}

export function closeEmailTransport(): void {
  if (cachedTransport !== null) {
    cachedTransport.close();
    cachedTransport = null;
  }
}
