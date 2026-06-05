import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';
import { DEFAULT_DOCUMENT_SETTINGS } from '@/lib/documentSettings';

import { DocumentToolbar } from './DocumentToolbar';

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

    const onSearchHighlightChange = vi.fn();
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
          onSearchHighlightChange={onSearchHighlightChange}
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
    // Match count rendered as "current / total".
    await waitFor(() => {
      expect(screen.getByText('1 / 4')).toBeInTheDocument();
    });
    // Highlight callback should have been called.
    expect(onSearchHighlightChange).toHaveBeenCalledWith({ query: 'fire', activeMatchIndex: 0 });
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
          onSearchHighlightChange={vi.fn()}
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

  it('cycles through individual matches with next/prev buttons', async () => {
    const onPageChange = vi.fn();
    const onSearchHighlightChange = vi.fn();
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
          onSearchHighlightChange={onSearchHighlightChange}
        />
      </IntlWrapper>,
    );

    fireEvent.click(screen.getByTestId('document-tool-search'));
    const input = await screen.findByTestId('document-search-input');
    fireEvent.change(input, { target: { value: 'wall' } });
    fireEvent.submit(input.closest('form')!);

    // First match: page 2, local index 0.
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(2);
    });

    // Next → page 7, local 0 (second match globally).
    fireEvent.click(screen.getByTestId('document-search-next'));
    expect(onPageChange).toHaveBeenLastCalledWith(7);
    expect(onSearchHighlightChange).toHaveBeenLastCalledWith({ query: 'wall', activeMatchIndex: 0 });

    // Next → page 7, local 1 (third match, still same page).
    fireEvent.click(screen.getByTestId('document-search-next'));
    expect(onPageChange).toHaveBeenLastCalledWith(7);
    expect(onSearchHighlightChange).toHaveBeenLastCalledWith({ query: 'wall', activeMatchIndex: 1 });

    // Next → page 9, local 0.
    fireEvent.click(screen.getByTestId('document-search-next'));
    expect(onPageChange).toHaveBeenLastCalledWith(9);
    expect(onSearchHighlightChange).toHaveBeenLastCalledWith({ query: 'wall', activeMatchIndex: 0 });

    // Wraps back to page 2, local 0.
    fireEvent.click(screen.getByTestId('document-search-next'));
    expect(onPageChange).toHaveBeenLastCalledWith(2);

    // Prev wraps backward to page 9.
    fireEvent.click(screen.getByTestId('document-search-prev'));
    expect(onPageChange).toHaveBeenLastCalledWith(9);
  });
});
