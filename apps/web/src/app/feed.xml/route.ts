import { getAllPosts } from '@/lib/blog/mdx';

const siteUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://bimdossier.nl';

// Single English feed — blog content is authored in English by default, with
// optional Dutch translations available at /nl/blog/<slug>. If we ever ship a
// dedicated Dutch feed, branch this route on a locale query param.
const FEED_LOCALE = 'en';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function GET(): Response {
  const posts = getAllPosts(FEED_LOCALE);

  const items = posts
    .map(
      (post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${siteUrl}/${FEED_LOCALE}/blog/${post.slug}</link>
      <description>${escapeXml(post.description)}</description>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <guid>${siteUrl}/${FEED_LOCALE}/blog/${post.slug}</guid>
    </item>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>BimDossier Blog</title>
    <link>${siteUrl}/${FEED_LOCALE}/blog</link>
    <description>Wet kwaliteitsborging voor het bouwen (Wkb) compliance, Dutch building regulations, and product updates.</description>
    <language>${FEED_LOCALE}</language>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
