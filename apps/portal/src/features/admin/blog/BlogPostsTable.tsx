'use client';

import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bimstitch/ui';

import type { BlogPostRead } from '@/lib/api/schemas';

type Props = {
  posts: BlogPostRead[];
  onDelete: (post: BlogPostRead) => void;
  onToggleStatus: (post: BlogPostRead) => void;
  deletingId: string | null;
  togglingId: string | null;
};

export function BlogPostsTable({
  posts,
  onDelete,
  onToggleStatus,
  deletingId,
  togglingId,
}: Props): JSX.Element {
  const t = useTranslations('admin.blog.table');

  if (posts.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-body3 text-foreground-tertiary">
        {t('empty')}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('title')}</TableHead>
          <TableHead>{t('locale')}</TableHead>
          <TableHead>{t('status')}</TableHead>
          <TableHead>{t('published')}</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.map((post) => (
          <TableRow key={post.id} className="hover:bg-background-hover">
            <TableCell>
              <div className="font-medium text-foreground">{post.title}</div>
              <div className="font-sans text-caption text-foreground-tertiary">
                {post.slug}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="default" size="sm">
                {post.locale.toUpperCase()}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant={post.status === 'published' ? 'success' : 'default'} size="sm">
                {t(`statusLabel.${post.status as 'draft' | 'published'}`)}
              </Badge>
            </TableCell>
            <TableCell className="text-foreground-tertiary">
              {new Date(post.published_at).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  variant="border"
                  size="sm"
                  onClick={() => { onToggleStatus(post); }}
                  disabled={togglingId === post.id}
                  aria-label={
                    post.status === 'published'
                      ? t('unpublishAria', { title: post.title })
                      : t('publishAria', { title: post.title })
                  }
                  title={
                    post.status === 'published' ? t('unpublish') : t('publish')
                  }
                >
                  {post.status === 'published' ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="border"
                  size="sm"
                  onClick={() => { onDelete(post); }}
                  disabled={deletingId === post.id}
                  aria-label={t('deleteAria', { title: post.title })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
