// THROWAWAY: approximates Playwright --ui (context reuse + tracing) to reproduce
// the teardown stall headlessly. Delete after use.
import base from './playwright.config';

const cfg = base as unknown as { use?: Record<string, unknown> };
cfg.use = { ...(cfg.use ?? {}), video: 'off', trace: 'on' };

export default base;
