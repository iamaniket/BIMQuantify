import type { MetadataRoute } from 'next';

import { defaultLocale, supportedLocales } from '@bimdossier/i18n';

import { FEATURE_SLUGS } from '@/components/features/featureContent';
import { getAllPostsMerged } from '@/lib/blog/mdx';
import { env } from '@/lib/env';

const siteUrl = env.NEXT_PUBLIC_SITE_URL;

type SitemapEntry = MetadataRoute.Sitemap[number];

function localizedEntry(
  pathSuffix: string,
  lastModified: Date,
  changeFrequency: SitemapEntry['changeFrequency'],
  priority: number,
): SitemapEntry[] {
  const languages: Record<string, string> = {};
  for (const locale of supportedLocales) {
    languages[locale] = `${siteUrl}/${locale}${pathSuffix}`;
  }
  return supportedLocales.map((locale) => ({
    url: `${siteUrl}/${locale}${pathSuffix}`,
    lastModified,
    changeFrequency,
    priority: locale === defaultLocale ? priority : priority * 0.9,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    ...localizedEntry('', now, 'weekly', 1),
    ...localizedEntry('/blog', now, 'weekly', 0.8),
    ...localizedEntry('/contact', now, 'monthly', 0.7),
    // request-access + legal now live in the portal (see next.config redirects).
  ];

  const featurePages: MetadataRoute.Sitemap = FEATURE_SLUGS.flatMap((slug) =>
    localizedEntry(`/features/${slug}`, now, 'monthly', 0.7),
  );

  const blogPages: MetadataRoute.Sitemap = (await getAllPostsMerged(defaultLocale)).flatMap((post) =>
    localizedEntry(`/blog/${post.slug}`, new Date(post.date), 'monthly', 0.6),
  );

  return [...staticPages, ...featurePages, ...blogPages];
}
