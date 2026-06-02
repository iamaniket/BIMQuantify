import type { JSX } from 'react';

import { HeroGrid } from '@bimstitch/brand';

import type { PostMeta } from '@/lib/blog/types';

type BlogPostHeroProps = {
  meta: PostMeta;
};

export function BlogPostHero({ meta }: BlogPostHeroProps): JSX.Element {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand-gradient-start)] to-[var(--brand-gradient-end)]" />
      <HeroGrid opacity={0.08} stroke="#ffffff" step={36} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(95,217,158,0.15),transparent)]" />

      <div className="relative mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-16 sm:py-20">
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
      </div>
    </section>
  );
}
