import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TokenPair } from '@/lib/api/schemas';

import { useUploadAttachment } from './useUploadAttachment';

// POOL-CLIENT-1 regression: a free (org-less) user resolving a snag with an
// evidence photo uploaded via the PAID `/projects/...` attachment surface →
// 409 NO_ACTIVE_ORGANIZATION. `useUploadAttachment` now self-derives the tier
// (org-less ⇒ pooled) and routes the upload to `/pooled/...` so the resolve flow
// works without callers threading a flag.
const h = vi.hoisted(() => ({
  tokens: null as TokenPair | null,
  me: null as { active_organization_id: string | null } | null,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ tokens: h.tokens, me: h.me }),
}));

const uploadAttachmentEnd2End = vi.fn();
vi.mock('@/lib/api/attachments', () => ({
  uploadAttachmentEnd2End: (...args: unknown[]) => uploadAttachmentEnd2End(...args) as unknown,
}));

function tok(access: string): TokenPair {
  return { access_token: access, refresh_token: `r-${access}`, token_type: 'bearer' };
}

function makeWrapper(): (props: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  h.tokens = tok('A');
  h.me = { active_organization_id: null };
  uploadAttachmentEnd2End.mockReset();
  uploadAttachmentEnd2End.mockResolvedValue({ id: 'att1' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useUploadAttachment tier routing (POOL-CLIENT-1)', () => {
  it('uploads to the POOLED surface for a free (org-less) user — never the paid 409 path', async () => {
    const file = new File(['x'], 'snag.jpg', { type: 'image/jpeg' });
    const { result } = renderHook(() => useUploadAttachment('p1'), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ file });
    // Trailing positional `free` arg is true for an org-less user.
    expect(uploadAttachmentEnd2End).toHaveBeenCalledWith(
      'A', 'p1', expect.any(File), expect.anything(), undefined, true,
    );
  });

  it('uploads to the PAID surface for an org (paid) user', async () => {
    h.me = { active_organization_id: 'org1' };
    const file = new File(['x'], 'snag.jpg', { type: 'image/jpeg' });
    const { result } = renderHook(() => useUploadAttachment('p1'), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ file });
    expect(uploadAttachmentEnd2End).toHaveBeenCalledWith(
      'A', 'p1', expect.any(File), expect.anything(), undefined, false,
    );
  });
});
