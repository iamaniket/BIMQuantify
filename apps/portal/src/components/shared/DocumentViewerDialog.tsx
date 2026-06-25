'use client';

import { Download, FileBadge, Info } from '@bimdossier/ui/icons';
import type { AppIcon } from '@bimdossier/ui/icons';
import type { JSX, ReactNode } from 'react';

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Eyebrow,
} from '@bimdossier/ui';

// ─── Metadata rail ───────────────────────────────────────────────────

export type MetaRow = { label: string; value: ReactNode; mono?: boolean };
export type MetaGroupSpec = { title: string; rows: MetaRow[] };

function MetaGroup({ title, rows }: MetaGroupSpec): JSX.Element {
  return (
    <div>
      <Eyebrow as="div" tone="tertiary" className="mb-2.5">
        {title}
      </Eyebrow>
      <div className="flex flex-col">
        {rows.map(({ label, value, mono }) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-border py-[7px] last:border-b-0"
          >
            <span className="shrink-0 whitespace-nowrap text-[12.5px] text-foreground-tertiary">
              {label}
            </span>
            <span
              className={`min-w-0 max-w-[62%] break-words text-right text-[12.5px] font-medium tabular-nums text-foreground ${
                mono === true ? 'font-sans' : ''
              }`}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Media-stage helpers (shared by every consumer's preview renderer) ─

/** Centered file icon + filename fallback when a file type can't be previewed. */
export function NoPreview({
  filename,
  label,
  icon: Icon = FileBadge,
}: {
  filename: string;
  label: string;
  icon?: AppIcon;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <Icon className="h-12 w-12 text-foreground-tertiary" />
      <p className="text-body3 font-medium text-foreground">{filename}</p>
      <p className="text-caption text-foreground-tertiary">{label}</p>
    </div>
  );
}

/** Small absolute-positioned overlay badge for the media stage (e.g. image dims). */
export function StageBadge({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="absolute bottom-3 left-3 rounded bg-black/55 px-2 py-1 font-sans text-[10.5px] tracking-wide text-white backdrop-blur-sm">
      {children}
    </div>
  );
}

// ─── Dialog shell ────────────────────────────────────────────────────

type DocumentViewerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Header heading. */
  title: ReactNode;
  /** Header sub-heading. */
  subtitle: ReactNode;
  /**
   * Light/image surface (`bg-surface-highest`) for the media stage vs the darker
   * document surface (`bg-background-secondary`). Defaults to the document look.
   */
  imageStage?: boolean;
  /** Media-stage content — the consumer renders its own iframe / img / spinner. */
  preview: ReactNode;
  /**
   * Optional full-width strip rendered between the header and body (e.g. an
   * annotation toolbar). Inert when omitted.
   */
  toolbar?: ReactNode;
  /** Collapse the metadata rail so the media stage spans the full width. */
  hideRail?: boolean;
  /** Optional free-text block rendered at the top of the metadata rail. */
  description?: ReactNode;
  /** Grouped key/value rows for the metadata rail. */
  metaGroups: MetaGroupSpec[];
  /** Left-hand footer info line (e.g. date · author). */
  footerInfo: ReactNode;
  /** Extra footer buttons rendered before Close (e.g. Annotate / Sign). */
  footerActions?: ReactNode;
  /**
   * When provided, fully replaces the default footer (info · actions · Close ·
   * Download) — the consumer renders its own cluster (e.g. hint · Cancel · Save).
   */
  footer?: ReactNode;
  closeLabel: string;
  /** Download button — rendered only when both label and handler are provided. */
  downloadLabel?: string | undefined;
  onDownload?: (() => void) | undefined;
  /** Forwarded to the underlying dialog (e.g. to keep an edit mode open on Escape). */
  onEscapeKeyDown?: ((event: KeyboardEvent) => void) | undefined;
};

/**
 * The portal's shared file-preview dialog — a split-panel shell with a media
 * stage on the left and a grouped metadata rail on the right, plus a footer
 * (info · actions · Close · Download). Used by the attachment, certificate and
 * report viewers so every file preview reads identically. Pure props: the
 * consumer owns the preview renderer and assembles the metadata rows.
 */
export function DocumentViewerDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  imageStage = false,
  preview,
  toolbar,
  hideRail = false,
  description,
  metaGroups,
  footerInfo,
  footerActions,
  footer,
  closeLabel,
  downloadLabel,
  onDownload,
  onEscapeKeyDown,
}: DocumentViewerDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[620px] max-h-[calc(100vh-48px)] w-[880px] max-w-[calc(100vw-48px)] flex-col overflow-hidden p-0"
        style={{ maxWidth: 'calc(100vw - 48px)' }}
        onEscapeKeyDown={(event) => { onEscapeKeyDown?.(event); }}
      >
        {/* Header */}
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        {/* Optional strip (e.g. annotation toolbar) */}
        {toolbar !== undefined && toolbar !== null && (
          <div className="shrink-0 border-b border-border px-4 py-2">{toolbar}</div>
        )}

        {/* Body — media stage + (optional) metadata rail */}
        <DialogBody
          className={`grid min-h-0 flex-1 gap-0 overflow-hidden p-0 ${
            hideRail ? 'grid-cols-1' : 'grid-cols-[1fr_296px]'
          }`}
        >
          <div className="min-h-0 p-5">
            <div
              className={`relative h-full w-full overflow-hidden rounded-lg ${
                imageStage ? 'bg-surface-highest' : 'bg-background-secondary'
              }`}
            >
              {preview}
            </div>
          </div>

          {!hideRail && (
            <div className="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface-low px-5 py-5">
              {description !== undefined && description !== null && description !== '' && (
                <div className="text-body3 leading-snug text-foreground-secondary">
                  {description}
                </div>
              )}
              {metaGroups.map((group) => (
                <MetaGroup key={group.title} title={group.title} rows={group.rows} />
              ))}
            </div>
          )}
        </DialogBody>

        {/* Footer — custom override, or default info · actions · Close · Download */}
        <DialogFooter className="mx-0 shrink-0 items-center justify-between border-border bg-surface-low px-6 py-3.5">
          {footer !== undefined && footer !== null ? (
            footer
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2 text-foreground-tertiary">
                <Info className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-sans text-[11.5px]">{footerInfo}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {footerActions}
                <Button
                  type="button"
                  variant="border"
                  size="md"
                  onClick={() => { onOpenChange(false); }}
                >
                  {closeLabel}
                </Button>
                {downloadLabel !== undefined && onDownload !== undefined && (
                  <Button type="button" variant="primary" size="md" onClick={onDownload}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    {downloadLabel}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
