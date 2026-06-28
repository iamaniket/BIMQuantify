import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

// A controllable, in-flight upload: `mutateAsync` returns a promise we settle by
// hand so a test can interleave a removal *during* the upload (the H12 window).
const hoisted = vi.hoisted(() => {
  let resolve: ((value: { id: string }) => void) | null = null;
  return {
    mutateAsync: vi.fn(
      () => new Promise<{ id: string }>((res) => { resolve = res; }),
    ),
    settle: (value: { id: string }) => { resolve?.(value); },
    reset: () => { resolve = null; },
  };
});

vi.mock('@/features/attachments/useUploadAttachment', () => ({
  useUploadAttachment: () => ({ mutateAsync: hoisted.mutateAsync }),
}));

vi.mock('@/features/attachments/useAttachmentViewUrl', () => ({
  // Resolve immediately so thumbnails (and their remove/annotate buttons) render.
  useAttachmentViewUrl: (_projectId: string, attachmentId: string) => ({
    data: { download_url: `url:${attachmentId}` },
  }),
}));

vi.mock('@/features/attachments/ImageAnnotatorDialog', () => ({
  // Minimal stand-in: when open, expose a button that completes the annotation.
  ImageAnnotatorDialog: ({
    open,
    onAnnotated,
  }: {
    open: boolean;
    onAnnotated: (id: string) => void;
  }) =>
    open ? (
      <button type="button" data-testid="do-annotate" onClick={() => { onAnnotated('NEW'); }}>
        confirm
      </button>
    ) : null,
}));

// eslint-disable-next-line import/first
import { FindingPhotos } from './FindingPhotos';

afterEach(() => {
  vi.clearAllMocks();
  hoisted.reset();
});

describe('FindingPhotos — stale-closure lost-write (H12)', () => {
  it('removes via a functional updater, so a concurrently-uploaded photo is preserved', () => {
    const onChange = vi.fn();
    render(
      <IntlWrapper>
        <FindingPhotos projectId="p1" photoIds={['A', 'B']} onChange={onChange} />
      </IntlWrapper>,
    );

    fireEvent.click(screen.getAllByTitle('Remove photo')[0]!);

    // Old code passed a plain array snapshot; the fix passes a functional updater.
    const arg = onChange.mock.calls.at(-1)?.[0];
    expect(typeof arg).toBe('function');
    // Applied to the latest state (which already includes a mid-flight upload 'X'),
    // it drops only the removed photo and leaves the new one untouched.
    expect((arg as (prev: string[]) => string[])(['A', 'B', 'X'])).toEqual(['B', 'X']);
  });

  it('annotates via a functional updater, so a concurrently-uploaded photo is preserved', () => {
    const onChange = vi.fn();
    render(
      <IntlWrapper>
        <FindingPhotos projectId="p1" photoIds={['A', 'B']} onChange={onChange} />
      </IntlWrapper>,
    );

    fireEvent.click(screen.getAllByTitle('Annotate')[0]!); // annotate photo 'A'
    fireEvent.click(screen.getByTestId('do-annotate'));

    const arg = onChange.mock.calls.at(-1)?.[0];
    expect(typeof arg).toBe('function');
    expect((arg as (prev: string[]) => string[])(['A', 'B', 'X'])).toEqual(['NEW', 'B', 'X']);
  });

  it('does not resurrect a photo removed while its upload is in flight', async () => {
    function Harness(): JSX.Element {
      const [ids, setIds] = useState<string[]>(['A', 'B']);
      return (
        <IntlWrapper>
          <output data-testid="ids">{ids.join(',')}</output>
          <FindingPhotos projectId="p1" photoIds={ids} onChange={setIds} />
        </IntlWrapper>
      );
    }

    const { container } = render(<Harness />);
    expect(screen.getByTestId('ids')).toHaveTextContent(/^A,B$/);

    // Start an upload — it stays in flight until we settle it.
    const input = container.querySelector('input[type="file"]')!;
    const file = new File(['x'], 'c.png', { type: 'image/png' });
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      fireEvent.change(input);
    });
    expect(hoisted.mutateAsync).toHaveBeenCalledTimes(1);

    // Remove 'A' while the upload is still pending.
    await act(async () => {
      fireEvent.click(screen.getAllByTitle('Remove photo')[0]!);
    });
    expect(screen.getByTestId('ids')).toHaveTextContent(/^B$/);

    // Now the upload completes and merges its result.
    await act(async () => {
      hoisted.settle({ id: 'C' });
    });

    // The merge appends to the *latest* selection: 'A' stays gone, 'C' is added.
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent(/^B,C$/));
  });
});
