import Image from 'next/image';
import type { JSX } from 'react';

import { HeroGrid } from '@bimstitch/brand';

type BlogCardThumbnailProps = {
  slug: string;
  image?: string;
  title: string;
};

const GRADIENTS = [
  'from-[var(--brand-gradient-start)] to-[var(--brand-gradient-end)]',
  'from-[var(--brand-gradient-end)] to-[var(--brand-gradient-start)]',
  'from-[var(--brand-gradient-start)] to-[var(--primary-dark,var(--brand-gradient-end))]',
  'from-[var(--brand-gradient-end)] via-[var(--brand-gradient-start)] to-[var(--brand-gradient-end)]',
  'from-[var(--brand-gradient-start)] via-[var(--brand-gradient-end)] to-[var(--brand-gradient-start)]',
];

function hashSlug(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function BlogCardThumbnail({
  slug,
  image,
  title,
}: BlogCardThumbnailProps): JSX.Element {
  if (image) {
    return (
      <div className="relative aspect-[16/10] w-full">
        <Image
          src={image}
          alt={title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 100vw, 50vw"
        />
      </div>
    );
  }

  const idx = hashSlug(slug) % GRADIENTS.length;
  const gradient = GRADIENTS[idx];

  return (
    <div
      className={`relative aspect-[16/10] w-full bg-gradient-to-br ${gradient}`}
    >
      <HeroGrid opacity={0.1} stroke="#ffffff" step={28} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_70%_30%,rgba(95,217,158,0.12),transparent)]" />
    </div>
  );
}
