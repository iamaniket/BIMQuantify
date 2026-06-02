import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock nodemailer before importing the module under test.
const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-id' });
const closeMock = vi.fn();

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: sendMailMock,
    close: closeMock,
  })),
}));

// Mock config to use SMTP transport.
vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_FROM: 'no-reply@bimstitch.dev',
    POSTMARK_SERVER_TOKEN: undefined,
  }),
  QUEUE_NAME: 'jobs',
  ACTION_QUEUE_NAME: 'actions',
}));

// Mock logger to avoid pino setup issues.
vi.mock('../src/log.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('renderEmailHtml', () => {
  it('renders body text and subject in HTML', async () => {
    const { renderEmailHtml } = await import('../src/email/template.js');
    const html = renderEmailHtml({
      subject: 'Test Subject',
      body: 'Hello world',
    });

    expect(html).toContain('Test Subject');
    expect(html).toContain('Hello world');
    expect(html).toContain('BimDossier');
    expect(html).toContain('<!doctype html>');
  });

  it('renders action button when action_url is provided', async () => {
    const { renderEmailHtml } = await import('../src/email/template.js');
    const html = renderEmailHtml({
      subject: 'Test',
      body: 'Body text',
      action_url: 'https://app.bimstitch.com/projects/abc',
      action_label: 'View project',
    });

    expect(html).toContain('https://app.bimstitch.com/projects/abc');
    expect(html).toContain('View project');
  });

  it('omits action button when no action_url', async () => {
    const { renderEmailHtml } = await import('../src/email/template.js');
    const html = renderEmailHtml({
      subject: 'Test',
      body: 'Body text',
    });

    expect(html).not.toContain('<a href=');
  });

  it('uses blue accent for reminder type', async () => {
    const { renderEmailHtml } = await import('../src/email/template.js');
    const html = renderEmailHtml({
      subject: 'Test',
      body: 'Body',
      type: 'reminder',
    });

    expect(html).toContain('#2563eb');
  });

  it('uses red accent for alert type', async () => {
    const { renderEmailHtml } = await import('../src/email/template.js');
    const html = renderEmailHtml({
      subject: 'Test',
      body: 'Body',
      type: 'alert',
    });

    expect(html).toContain('#dc2626');
  });

  it('escapes HTML in body text', async () => {
    const { renderEmailHtml } = await import('../src/email/template.js');
    const html = renderEmailHtml({
      subject: 'Test',
      body: 'Hello <script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('runSendEmail', () => {
  beforeEach(() => {
    sendMailMock.mockClear();
  });

  it('sends email via SMTP transport with rendered HTML', async () => {
    const { runSendEmail } = await import('../src/email/send.js');

    await runSendEmail({
      job_id: 'test-123',
      job_type: 'send_email',
      organization_id: '00000000-0000-0000-0000-000000000000',
      payload: {
        to: 'user@example.com',
        subject: 'Test Subject',
        body: 'Hello world',
        action_url: 'https://example.com',
        action_label: 'Click here',
        type: 'reminder',
      },
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toBe('Test Subject');
    expect(call.text).toBe('Hello world');
    expect(call.html).toContain('Hello world');
    expect(call.html).toContain('#2563eb');
  });

  it('rejects invalid payload', async () => {
    const { runSendEmail } = await import('../src/email/send.js');

    await expect(
      runSendEmail({
        job_id: 'test-123',
        job_type: 'send_email',
        organization_id: '00000000-0000-0000-0000-000000000000',
        payload: { to: 'not-an-email' },
      }),
    ).rejects.toThrow('invalid send_email payload');

    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
