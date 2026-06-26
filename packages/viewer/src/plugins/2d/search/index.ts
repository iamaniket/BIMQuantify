/**
 * PDF search plugin. Owns full-text search across pages (`search.find`) and the
 * highlight pass that wraps matches on the rendered text layer in
 * `<mark class="bq-highlight">`. Re-applies highlights whenever the active
 * highlight changes or the page re-renders, and reports the per-page match
 * count via `search:matchCount`. Ported from the old DocumentViewer.
 */

import { verror } from '../../../core/debugLog.js';
import type {
  DocumentContext,
  DocumentPlugin,
  DocumentSearchHit,
  SearchHighlightState,
} from '../../../pdf-core/documentTypes.js';

export function searchPlugin(): DocumentPlugin {
  let ctx: DocumentContext | null = null;
  // Per-document joined-lowercased page text, for the find scan.
  const pageTextCache = new Map<number, string>();
  let highlight: SearchHighlightState | null = null;
  const cleanups: Array<() => void> = [];

  async function find(query: string): Promise<DocumentSearchHit[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0 || ctx === null) return [];
    const numPages = ctx.getNumPages();
    const needle = trimmed.toLowerCase();
    const hits: DocumentSearchHit[] = [];

    for (let i = 1; i <= numPages; i += 1) {
      let pageText = pageTextCache.get(i);
      if (pageText === undefined) {
        // No text source (e.g. mobile server-image PDFs) → search is a no-op.
        const textPromise = ctx.getPageText(i);
        if (textPromise === undefined) break;
        try {
          pageText = await textPromise;
          pageTextCache.set(i, pageText);
        } catch (err) {
          // Do NOT cache '' for a page whose text extraction threw — caching it
          // makes the miss sticky (0 hits for that page for the document's
          // lifetime). Skip the page this round and surface it so a broken page
          // is observable; the next search retries it.
          verror('search', `text extraction failed for page ${String(i)} — skipping`, err);
          continue;
        }
      }
      if (pageText.length === 0) continue;
      let count = 0;
      let idx = pageText.indexOf(needle);
      while (idx !== -1) {
        count += 1;
        idx = pageText.indexOf(needle, idx + needle.length);
      }
      if (count > 0) hits.push({ pageIndex: i, matchesOnPage: count });
    }
    return hits;
  }

  function applyHighlight(): void {
    if (!ctx) return;
    const el = ctx.textLayer;
    const container = ctx.container;

    // Clear previous highlights — restore original text nodes.
    for (const mark of Array.from(el.querySelectorAll('mark.bq-highlight'))) {
      const parent = mark.parentNode;
      if (parent !== null) {
        parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
        parent.normalize();
      }
    }

    if (highlight === null || highlight.query.trim().length === 0) {
      ctx.events.emit('search:matchCount', { count: 0 });
      return;
    }

    const needle = highlight.query.trim().toLowerCase();
    const activeIdx = highlight.activeMatchIndex;
    let matchCount = 0;

    const spans = el.querySelectorAll<HTMLSpanElement>('span');
    for (const span of Array.from(spans)) {
      const text = span.textContent ?? '';
      const lower = text.toLowerCase();
      let idx = lower.indexOf(needle);
      if (idx === -1) continue;

      const fragment = document.createDocumentFragment();
      let lastEnd = 0;

      while (idx !== -1) {
        if (idx > lastEnd) {
          fragment.appendChild(document.createTextNode(text.slice(lastEnd, idx)));
        }
        const mark = document.createElement('mark');
        mark.className =
          matchCount === activeIdx ? 'bq-highlight active' : 'bq-highlight';
        mark.textContent = text.slice(idx, idx + needle.length);
        fragment.appendChild(mark);
        matchCount += 1;
        lastEnd = idx + needle.length;
        idx = lower.indexOf(needle, lastEnd);
      }

      if (lastEnd < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
      }

      span.textContent = '';
      span.appendChild(fragment);
    }

    ctx.events.emit('search:matchCount', { count: matchCount });

    // Scroll the active highlight into view inside the scrollable container.
    const activeMark = el.querySelector<HTMLElement>('mark.bq-highlight.active');
    if (activeMark !== null) {
      const cRect = container.getBoundingClientRect();
      const mRect = activeMark.getBoundingClientRect();
      const outOfView =
        mRect.top < cRect.top ||
        mRect.bottom > cRect.bottom ||
        mRect.left < cRect.left ||
        mRect.right > cRect.right;
      if (outOfView) {
        activeMark.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
    }
  }

  return {
    name: 'search',

    install(context: DocumentContext): void {
      ctx = context;

      context.commands.register<string, DocumentSearchHit[]>(
        'search.find',
        (query) => find(query ?? ''),
        { title: 'Find in document' },
      );

      cleanups.push(
        context.events.on('search:highlight', ({ highlight: next }) => {
          highlight = next;
          applyHighlight();
        }),
      );
      // Re-apply after every page render (the text layer was rebuilt).
      cleanups.push(context.events.on('page:rendered', () => { applyHighlight(); }));
      // New document → drop the per-page text cache.
      cleanups.push(context.events.on('doc:loaded', () => { pageTextCache.clear(); }));
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      pageTextCache.clear();
      highlight = null;
      ctx = null;
    },
  };
}
