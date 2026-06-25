import type { JSX } from 'react';

import { cn } from '@bimdossier/ui';

const SIZE_CLASSES = {
  sm: 'h-6 w-6 text-[9px]',
  md: 'h-8 w-8 text-[11px]',
  lg: 'h-10 w-10 text-[13px]',
} as const;

type Size = keyof typeof SIZE_CLASSES;

function toInitials(name: string, email?: string): string {
  const cleaned = name.trim();
  if (cleaned.length === 0) {
    const fallback = email ?? '';
    const local = fallback.includes('@') ? (fallback.split('@')[0] ?? fallback) : fallback;
    const parts = local.split(/[\s._-]+/).filter((p) => p.length > 0);
    if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();
    if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return cleaned.slice(0, 2).toUpperCase();
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

type Props = {
  name: string;
  email?: string;
  src?: string | null;
  size?: Size;
  className?: string;
};

export function UserAvatar({
  name,
  email,
  src,
  size = 'md',
  className,
}: Props): JSX.Element {
  const sizeClass = SIZE_CLASSES[size];
  const initials = toInitials(name, email);
  const displayName = name.trim() || email || 'User';

  if (src !== null && src !== undefined) {
    return (
      <img
        src={src}
        alt={displayName}
        className={cn('rounded-full object-cover', sizeClass, className)}
      />
    );
  }

  return (
    <div
      title={displayName}
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-primary-light font-extrabold text-primary',
        sizeClass,
        className,
      )}
    >
      {initials}
    </div>
  );
}

export { toInitials };
