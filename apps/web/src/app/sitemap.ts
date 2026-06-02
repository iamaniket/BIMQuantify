import type { MetadataRoute } from 'next';

import { defaultLocale, supportedLocales } from '@bimstitch/i18n';

import { getAllPosts } from '@/lib/blog/mdx';

const siteUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://bimdossier.nl';

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

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    ...localizedEntry('', now, 'weekly', 1),
    ...localizedEntry('/blog', now, 'weekly', 0.8),
    ...localizedEntry('/request-access', now, 'monthly', 0.7),
  ];

  const blogPages: MetadataRoute.Sitemap = getAllPosts(defaultLocale).flatMap((post) =>
    localizedEntry(`/blog/${post.slug}`, new Date(post.date), 'monthly', 0.6),
  );

  return [...staticPages, ...blogPages];
}
