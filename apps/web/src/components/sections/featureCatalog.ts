import {
  AlertTriangle,
  Bell,
  Boxes,
  CalendarClock,
  Camera,
  ClipboardCheck,
  FileBadge,
  FileText,
  FolderKanban,
  MapPin,
  MessageSquare,
  ShieldCheck,
  Share2,
  Smartphone,
  Sparkles,
  Users,
  type AppIcon,
} from '@bimdossier/ui/icons';

/**
 * Single source of truth for the marketing feature list. `available` items
 * render in `FeaturesSection`; `coming_soon` items render dimmed in
 * `RoadmapSection`. Promoting a roadmap item to shipped is a one-line `status`
 * flip here (plus moving its copy from `roadmap.items.*` to `features.*` in the
 * message catalogs). Statuses are verified against live code, not the backlog
 * CSV — anything partial/deferred stays in `coming_soon`.
 */
export type FeatureStatus = 'available' | 'coming_soon';

export type FeatureItem = {
  /** i18n key under `features.*` (available) or `roadmap.items.*` (coming_soon). */
  key: string;
  icon: AppIcon;
  status: FeatureStatus;
};

const FEATURES: FeatureItem[] = [
  // Shipped — verified against code.
  { key: 'deadlines', icon: CalendarClock, status: 'available' },
  { key: 'dossier', icon: ClipboardCheck, status: 'available' },
  { key: 'findings', icon: AlertTriangle, status: 'available' },
  { key: 'snagging', icon: MapPin, status: 'available' },
  { key: 'board', icon: FolderKanban, status: 'available' },
  { key: 'photos', icon: Camera, status: 'available' },
  { key: 'mobile', icon: Smartphone, status: 'available' },
  { key: 'viewer', icon: Boxes, status: 'available' },
  { key: 'certificates', icon: FileBadge, status: 'available' },
  { key: 'reports', icon: FileText, status: 'available' },
  { key: 'bcf', icon: Share2, status: 'available' },
  { key: 'collaboration', icon: Users, status: 'available' },
  // Roadmap — verified NOT shipped.
  { key: 'comments', icon: MessageSquare, status: 'coming_soon' },
  { key: 'handover', icon: ShieldCheck, status: 'coming_soon' },
  { key: 'ai', icon: Sparkles, status: 'coming_soon' },
  { key: 'push', icon: Bell, status: 'coming_soon' },
];

export const AVAILABLE_FEATURES = FEATURES.filter((f) => f.status === 'available');
export const ROADMAP_FEATURES = FEATURES.filter((f) => f.status === 'coming_soon');

/**
 * Pre-launch gate. While `false`, the shipped capabilities are presented as
 * dimmed "coming soon" cards (no detail-page links) and `/features/<key>`
 * redirects to /coming-soon. Flip to `true` at launch to restore clickable
 * cards + detail pages. This is the single toggle for the whole behaviour.
 * Typed `boolean` (not the `false` literal) so flipping it stays a one-line
 * change and the `LAUNCHED ? …` branches don't read as constant conditions.
 */
export const LAUNCHED: boolean = false;
