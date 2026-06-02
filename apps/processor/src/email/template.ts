/**
 * Branded HTML email layout. Wraps plain-text content from the API in a
 * responsive HTML shell with header, accent bar, optional CTA button, and
 * footer. The processor has no domain knowledge — it just formats whatever
 * the API sends.
 */

export type EmailStyle = 'reminder' | 'alert' | 'info';

export type EmailTemplateInput = {
  subject: string;
  body: string;
  action_url?: string;
  action_label?: string;
  type?: EmailStyle;
};

const ACCENT_COLORS: Record<EmailStyle, string> = {
  reminder: '#2563eb',
  alert: '#dc2626',
  info: '#6b7280',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bodyToHtml(text: string): string {
  return escapeHtml(text)
    .split('\n\n')
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function renderEmailHtml(input: EmailTemplateInput): string {
  const style = input.type ?? 'info';
  const accent = ACCENT_COLORS[style];

  const buttonHtml = input.action_url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
        <tr>
          <td style="border-radius:6px;background:${accent}">
            <a href="${escapeHtml(input.action_url)}"
               style="display:inline-block;padding:12px 24px;color:#ffffff;
                      text-decoration:none;font-weight:600;font-size:14px">
              ${escapeHtml(input.action_label ?? 'View details')}
            </a>
          </td>
        </tr>
      </table>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0"
               style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
          <!-- Accent bar -->
          <tr>
            <td style="height:4px;background:${accent}"></td>
          </tr>
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px 0">
              <span style="font-size:18px;font-weight:700;color:#111827">BimDossier</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px 32px;color:#374151;font-size:15px">
              ${bodyToHtml(input.body)}
              ${buttonHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e7eb;
                        color:#9ca3af;font-size:12px;text-align:center">
              &copy; BimDossier &middot; This is an automated message
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
