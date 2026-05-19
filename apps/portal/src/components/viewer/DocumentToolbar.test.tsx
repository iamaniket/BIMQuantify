import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';
import { DEFAULT_DOCUMENT_SETTINGS } from '@/lib/documentSettings';

import { DocumentToolbar } from './DocumentToolbar';

// next-themes ships as a client component; we don't care about its behaviour
// here, just stub useTheme so the toolbar renders.
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}));

function buildHandle(
  matches: { pageIndex: number; matchesOnPage: number }[] = [],
): {
  zoomIn: ReturnType<typeof vi.fn>;
  zoomOut: ReturnType<typeof vi.fn>;
  zoomTo: ReturnType<typeof vi.fn>;
  fitPage: ReturnType<typeof vi.fn>;
  fitWidth: ReturnType<typeof vi.fn>;
  actualSize: ReturnType<typeof vi.fn>;
  rotateBy: ReturnType<typeof vi.fn>;
  searchText: ReturnType<typeof vi.fn>;
} {
  return {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomTo: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
    actualSize: vi.fn(),
    rotateBy: vi.fn(),
    searchText: vi.fn().mockResolvedValue(matches),
  };
}

describe('DocumentToolbar search', () => {
  it('opens search input on icon click and runs a search on submit', async () => {
    const onPageChange = vi.fn();
    const handle = buildHandle([
      { pageIndex: 2, matchesOnPage: 3 },
      { pageIndex: 5, matchesOnPage: 1 },
    ]);

    render(
      <IntlWrapper locale="en">
        <DocumentToolbar
          currentPage={1}
          numPages={10}
          scale={1}
          activeTool="select"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          documentHandle={handle as any}
          settings={DEFAULT_DOCUMENT_SETTINGS}
          onPageChange={onPageChange}
          onScaleChange={vi.fn()}
          onActiveToolChange={vi.fn()}
          onSettingsChange={vi.fn()}
        />
      </IntlWrapper>,
    );

    fireEvent.click(screen.getByTestId('document-tool-search'));

    const input = await screen.findByTestId('document-search-input');
    fireEvent.change(input, { target: { value: 'fire' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(handle.searchText).toHaveBeenCalledWith('fire');
    });
    // First hit's page should be jumped to.
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });
    // Match count rendered (4 total matches on 2 pages).
    await waitFor(() => {
      expect(screen.getByText('4 matches on 2 pages')).toBeInTheDocument();
    });
  });

  it('renders empty-state when there are no matches', async () => {
    const onPageChange = vi.fn();
    const handle = buildHandle([]);

    render(
      <IntlWrapper locale="en">
        <DocumentToolbar
          currentPage={1}
          numPages={10}
          scale={1}
          activeTool="select"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          documentHandle={handle as any}
          settings={DEFAULT_DOCUMENT_SETTINGS}
          onPageChange={onPageChange}
          onScaleChange={vi.fn()}
          onActiveToolChange={vi.fn()}
          onSettingsChange={vi.fn()}
        />
      </IntlWrapper>,
    );

    fireEvent.click(screen.getByTestId('document-tool-search'));
    const input = await screen.findByTestId('document-search-input');
    fireEvent.change(input, { target: { value: 'nothing' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('No matches')).toBeInTheDocument();
    });
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('cycles through hits with next/prev buttons', async () => {
    const onPageChange = vi.fn();
    const handle = buildHandle([
      { pageIndex: 2, matchesOnPage: 1 },
      { pageIndex: 7, matchesOnPage: 2 },
      { pageIndex: 9, matchesOnPage: 1 },
    ]);

    render(
      <IntlWrapper locale="en">
        <DocumentToolbar
          currentPage={1}
          numPages={10}
          scale={1}
          activeTool="select"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          documentHandle={handle as any}
          settings={DEFAULT_DOCUMENT_SETTINGS}
          onPageChange={onPageChange}
          onScaleChange={vi.fn()}
          onActiveToolChange={vi.fn()}
          onSettingsChange={vi.fn()}
        />
      </IntlWrapper>,
    );

    fireEvent.click(screen.getByTestId('document-tool-search'));
    const input = await screen.findByTestId('document-search-input');
    fireEvent.change(input, { target: { value: 'wall' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(2);
    });

    fireEvent.click(screen.getByTestId('document-search-next'));
    expect(onPageChange).toHaveBeenLastCalledWith(7);
    fireEvent.click(screen.getByTestId('document-search-next'));
    expect(onPageChange).toHaveBeenLastCalledWith(9);
    // Wraps back to first.
    fireEvent.click(screen.getByTestId('document-search-next'));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    // Prev wraps backward.
    fireEvent.click(screen.getByTestId('document-search-prev'));
    expect(onPageChange).toHaveBeenLastCalledWith(9);
  });
});
