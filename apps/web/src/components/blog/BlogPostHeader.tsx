import type { JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import type { PostMeta } from '@/lib/blog/types';

type BlogPostHeaderProps = {
  meta: PostMeta;
};

export function BlogPostHeader({ meta }: BlogPostHeaderProps): JSX.Element {
  return (
    <header className="mb-10 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {meta.tags.map((tag) => (
          <Badge key={tag} variant="primary" size="md">
            {tag}
          </Badge>
        ))}
      </div>

      <h1 className="text-h2 font-semibold text-foreground">{meta.title}</h1>

      <p className="text-title3 text-foreground-secondary">
        {meta.description}
      </p>

      <div className="flex items-center gap-3 text-body3 text-foreground-tertiary">
        <span>{meta.author}</span>
        <span>·</span>
        <time dateTime={meta.date}>
          {new Date(meta.date).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </time>
        <span>·</span>
        <span>{meta.readingTime}</span>
      </div>

      <hr className="border-border" />
    </header>
  );
}
