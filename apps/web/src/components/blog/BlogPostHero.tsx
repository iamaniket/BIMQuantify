import type { JSX } from 'react';

import { HeroPill } from '@/components/sections/HeroPill';
import { HeroShell } from '@/components/sections/HeroShell';
import { formatBlogDate } from '@/lib/formatting/dates';
import type { PostMeta } from '@/lib/blog/types';

type BlogPostHeroProps = {
  meta: PostMeta;
  locale: string;
};

export function BlogPostHero({ meta, locale }: BlogPostHeroProps): JSX.Element {
  return (
    <HeroShell size="page" className="gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {meta.tags.map((tag) => (
          <HeroPill key={tag} compact>
            {tag}
          </HeroPill>
        ))}
      </div>

      <h1 className="max-w-3xl text-h3 font-semibold text-white sm:text-h2">
        {meta.title}
      </h1>

      <p className="max-w-2xl text-body1 text-white/70">{meta.description}</p>

      <div className="flex items-center gap-3 text-body3 text-white/50">
        <span>{meta.author}</span>
        <span>·</span>
        <time dateTime={meta.date}>
          {formatBlogDate(meta.date, locale, 'long')}
        </time>
        <span>·</span>
        <span>{meta.readingTime}</span>
      </div>
    </HeroShell>
  );
}
