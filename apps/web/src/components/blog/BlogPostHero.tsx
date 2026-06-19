import type { JSX } from 'react';

import { HeroShell } from '@/components/sections/HeroShell';
import type { PostMeta } from '@/lib/blog/types';

type BlogPostHeroProps = {
  meta: PostMeta;
};

export function BlogPostHero({ meta }: BlogPostHeroProps): JSX.Element {
  return (
    <HeroShell size="page" className="gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {meta.tags.map((tag) => (
          <span
            key={tag}
            className="w-fit rounded-full border border-white/20 bg-white/10 px-2 py-1 text-body3 font-medium text-white/90"
          >
            {tag}
          </span>
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
          {new Date(meta.date).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </time>
        <span>·</span>
        <span>{meta.readingTime}</span>
      </div>
    </HeroShell>
  );
}
