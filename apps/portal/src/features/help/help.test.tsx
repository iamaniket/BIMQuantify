import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/help',
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { Sparkles } from '@bimdossier/ui/icons';

import { HelpArticleView } from './HelpArticleView';
import { HelpHubView } from './HelpHubView';
import { HelpNavRail } from './HelpNavRail';
import type { LocalizedArticle } from './useHelpContent';
import { useHelpArticle, useHelpArticles, useHelpStats } from './useHelpContent';

function wrapperFor(locale: 'en' | 'nl') {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <IntlWrapper locale={locale}>{children}</IntlWrapper>;
  };
}

describe('help content selectors', () => {
  it('localizes article titles per locale', () => {
    const en = renderHook(() => useHelpArticles(), { wrapper: wrapperFor('en') });
    expect(en.result.current.map((a) => a.title)).toContain('Getting started');

    const nl = renderHook(() => useHelpArticles(), { wrapper: wrapperFor('nl') });
    expect(nl.result.current.map((a) => a.title)).toContain('Aan de slag');
  });

  it('computes stats from the registry', () => {
    const { result } = renderHook(() => useHelpStats(), { wrapper: wrapperFor('en') });
    expect(result.current.articleCount).toBe(2);
    expect(result.current.categoryCount).toBe(2);
    expect(result.current.lastUpdated).toBe('2026-06-26');
  });

  it('returns undefined for an unknown slug', () => {
    const { result } = renderHook(() => useHelpArticle('does-not-exist'), {
      wrapper: wrapperFor('en'),
    });
    expect(result.current).toBeUndefined();
  });
});

describe('HelpHubView', () => {
  it('renders the welcome heading and category cards (en)', () => {
    render(
      <IntlWrapper locale="en">
        <HelpHubView />
      </IntlWrapper>,
    );
    expect(screen.getByText('How can we help?')).toBeInTheDocument();
    expect(screen.getByText('Getting started')).toBeInTheDocument();
    expect(screen.getByText('Viewer (3D / 2D)')).toBeInTheDocument();
  });

  it('renders Dutch labels (nl)', () => {
    render(
      <IntlWrapper locale="nl">
        <HelpHubView />
      </IntlWrapper>,
    );
    expect(screen.getByText('Waarmee kunnen we je helpen?')).toBeInTheDocument();
    expect(screen.getByText('Aan de slag')).toBeInTheDocument();
  });
});

describe('HelpNavRail', () => {
  it('groups articles under their category', () => {
    render(
      <IntlWrapper locale="en">
        <HelpNavRail />
      </IntlWrapper>,
    );
    // Unique strings (avoid the "Getting started" category-vs-article collision).
    expect(screen.getByText('Viewer (3D / 2D)')).toBeInTheDocument();
    expect(screen.getByText('Using the viewer')).toBeInTheDocument();
  });
});

describe('HelpArticleView markdown rendering', () => {
  const article: LocalizedArticle = {
    slug: 'demo',
    category: 'gettingStarted',
    icon: Sparkles,
    order: 1,
    lastUpdated: '2026-06-26',
    title: 'Demo article',
    summary: 'A demo article.',
    body: [
      '## Section heading',
      '',
      '- first item',
      '- second item',
      '',
      '[Open viewer docs](/help/using-the-viewer)',
      '',
      '| Col A | Col B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n'),
  };

  it('renders headings, lists, internal links and GFM tables', () => {
    render(
      <IntlWrapper locale="en">
        <HelpArticleView article={article} />
      </IntlWrapper>,
    );
    expect(screen.getByText('Demo article')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Section heading' })).toBeInTheDocument();
    expect(screen.getByText('first item')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Open viewer docs' });
    expect(link).toHaveAttribute('href', '/help/using-the-viewer');

    // remark-gfm turns the pipe block into a real table.
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
