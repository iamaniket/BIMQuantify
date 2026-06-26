'use client';

import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Link } from '@/i18n/navigation';

/**
 * Markdown → React element map. Every element renders with design-token Tailwind classes
 * (no raw hex / inline styles). Internal links (`/…`) route through next-intl's `Link`.
 * Block code styling lives on `pre`; the wrapper neutralises the inline-code chip inside
 * `pre` (react-markdown v9 dropped the `inline` flag, so we scope via a CSS variant).
 */
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-8 text-title2 font-semibold tracking-[-0.01em] text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2.5 mt-7 text-title3 font-semibold text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-5 text-body1 font-semibold text-foreground first:mt-0">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-body2 leading-relaxed text-foreground-secondary">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 ml-5 list-disc space-y-1.5 text-body2 text-foreground-secondary marker:text-foreground-tertiary">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-body2 text-foreground-secondary marker:text-foreground-tertiary">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ href, children }) => {
    const target = href ?? '#';
    if (target.startsWith('/')) {
      return (
        <Link href={target} className="font-medium text-primary underline-offset-2 hover:underline">
          {children}
        </Link>
      );
    }
    const external = target.startsWith('http');
    return (
      <a
        href={target}
        className="font-medium text-primary underline-offset-2 hover:underline"
        {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      >
        {children}
      </a>
    );
  },
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-surface-low px-1.5 py-0.5 text-body3 font-sans text-foreground">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg border border-border bg-surface-low p-3 text-body3 font-sans text-foreground">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 rounded-r-md border-l-2 border-primary-light bg-surface-low py-2 pl-4 pr-3 text-body2 text-foreground-secondary">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-body3">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-low">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-3 py-2 text-foreground-secondary">{children}</td>
  ),
};

export function MarkdownProse({ children }: { children: string }): ReactNode {
  return (
    <div className="max-w-3xl [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
