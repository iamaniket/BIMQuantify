'use client';

import { AlertTriangle, Box, Check, ChevronDown, ChevronRight, FileText, Link2, Plus, ShieldCheck, SlidersHorizontal, Upload } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@bimdossier/ui';

import type { CertificateTypeValue, DossierSlotValue } from '@/lib/api/schemas';
import { useUnslottedDocuments } from '@/features/attachments/useAttachments';
import { useUpdateAttachment } from '@/features/attachments/useUpdateAttachment';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';
import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';

import { CertificateUploadDialog } from './CertificateUploadDialog';
import { type DossierRequirementResult } from './dossierTemplate';
import { useDossierCompleteness } from './useDossierCompleteness';

type Props = {
  projectId: string;
  country: string;
  /** Switches the surrounding panel to the Models tab (drives the Drawings CTA). */
  onNavigateToModels?: () => void;
};

const SOURCE_ICONS: Record<DossierRequirementResult['sourceKind'], typeof Check> = {
  attachment_slot: FileText,
  certificate_type: ShieldCheck,
  derived: SlidersHorizontal,
  document: Box,
};

const OFFICE_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.txt';

export function DossierChecklistTab({ projectId, country, onNavigateToModels }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.dossier');

  const jurisdiction = useJurisdiction(country);
  const dossier = useDossierCompleteness(projectId, country);

  const uploadMutation = useUploadAttachment(projectId);
  const updateMutation = useUpdateAttachment(projectId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<DossierSlotValue | null>(null);
  const [linkSlot, setLinkSlot] = useState<DossierSlotValue | null>(null);
  const [certType, setCertType] = useState<CertificateTypeValue | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const categoryLabel = useCallback(
    (code: string): string => jurisdiction?.dossier_category_labels[code] ?? code,
    [jurisdiction],
  );

  const handleUploadInto = useCallback((slot: DossierSlotValue) => {
    pendingSlotRef.current = slot;
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const slot = pendingSlotRef.current;
      if (file !== undefined && slot !== null) {
        uploadMutation.mutate(
          { file, dossier_slot: slot },
          { onSuccess: () => { toast.success(t('uploadSuccess', { name: file.name })); } },
        );
      }
      pendingSlotRef.current = null;
      if (fileInputRef.current !== null) fileInputRef.current.value = '';
    },
    [uploadMutation, t],
  );

  const handleLinkExisting = useCallback(
    (attachmentId: string) => {
      if (linkSlot === null) return;
      updateMutation.mutate(
        { attachmentId, input: { dossier_slot: linkSlot } },
        {
          onSuccess: () => {
            toast.success(t('linkSuccess'));
            setLinkSlot(null);
          },
        },
      );
    },
    [linkSlot, updateMutation, t],
  );

  if (dossier.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (dossier.templateEmpty) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center">
        <FileText className="mx-auto mb-2 h-6 w-6 text-foreground-tertiary" />
        <div className="text-body3 font-semibold">{t('emptyTitle')}</div>
        <div className="mt-1 text-caption text-foreground-tertiary">{t('emptyDescription')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category groups — the headline percentage now lives in the Readiness tab header (see RightColumnTabs). */}
      {dossier.groups.map((group) => {
        const isCollapsed = collapsed.has(group.category);
        return (
          <section key={group.category}>
            <button
              type="button"
              onClick={() => {
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.category)) next.delete(group.category);
                  else next.add(group.category);
                  return next;
                });
              }}
              className="mb-2 flex w-full items-center gap-1.5 text-body3 font-semibold text-foreground-secondary hover:text-foreground"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {categoryLabel(group.category)}
              <span className="ml-1 text-caption tabular-nums text-foreground-tertiary">
                {group.filled}/{group.total}
              </span>
            </button>

            {!isCollapsed && (
              <ul className="space-y-1.5">
                {group.requirements.map((req) => (
                  <DossierRow
                    key={req.code}
                    req={req}
                    onUpload={handleUploadInto}
                    onLink={setLinkSlot}
                    onUploadCertificate={setCertType}
                    hasAnyModel={dossier.hasAnyModel}
                    onNavigateToModels={onNavigateToModels ?? (() => {})}
                    busy={uploadMutation.isPending}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={OFFICE_ACCEPT}
        onChange={handleFileChange}
      />

      <LinkExistingDialog
        projectId={projectId}
        open={linkSlot !== null}
        onOpenChange={(open) => { if (!open) setLinkSlot(null); }}
        onPick={handleLinkExisting}
        busy={updateMutation.isPending}
      />

      <CertificateUploadDialog
        projectId={projectId}
        open={certType !== null}
        onOpenChange={(open) => { if (!open) setCertType(null); }}
        initialType={certType ?? 'product'}
      />
    </div>
  );
}

function DossierRow({
  req,
  onUpload,
  onLink,
  onUploadCertificate,
  hasAnyModel,
  onNavigateToModels,
  busy,
}: {
  req: DossierRequirementResult;
  onUpload: (slot: DossierSlotValue) => void;
  onLink: (slot: DossierSlotValue) => void;
  onUploadCertificate: (type: CertificateTypeValue) => void;
  hasAnyModel: boolean;
  onNavigateToModels: () => void;
  busy: boolean;
}): JSX.Element {
  const t = useTranslations('projectDetail.tabs.dossier');
  const Icon = SOURCE_ICONS[req.sourceKind] ?? FileText;

  return (
    <li className="flex items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2">
      {req.fulfilled ? (
        <Check className="h-5 w-5 shrink-0 text-success" />
      ) : (
        <Icon className="h-5 w-5 shrink-0 text-foreground-tertiary" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body3 font-medium text-foreground">{req.label}</span>
          {!req.required && (
            <span className="rounded-full bg-background-secondary px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-foreground-tertiary">
              {t('optionalBadge')}
            </span>
          )}
        </div>
        <div className="text-caption text-foreground-tertiary">
          {req.fulfilled ? t('statusProvided', { count: req.count }) : t('statusMissing')}
        </div>
        {req.fulfilled && req.hasExpiredCert && (
          <div className="flex items-center gap-1 text-caption font-medium text-warning">
            <AlertTriangle className="h-3 w-3" />
            {t('expiredCertWarning')}
          </div>
        )}
      </div>

      {/* CTAs by source kind */}
      {req.sourceKind === 'attachment_slot' && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="md"
            onClick={() => { onLink(req.sourceValue as DossierSlotValue); }}
            title={t('linkExisting')}
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => { onUpload(req.sourceValue as DossierSlotValue); }}
            disabled={busy}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t('uploadCta')}
          </Button>
        </div>
      )}
      {req.sourceKind === 'certificate_type' && (
        <Button
          variant="primary"
          size="md"
          className="shrink-0"
          onClick={() => { onUploadCertificate(req.sourceValue as CertificateTypeValue); }}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {t('uploadCertificate')}
        </Button>
      )}
      {/* Drawings is model-backed: a button only when no model exists yet —
          it hands off to the Models tab to create one and upload files. Once
          any model is present the row just reflects met/processing state. */}
      {req.sourceKind === 'document' && !req.fulfilled && !hasAnyModel && (
        <Button
          variant="primary"
          size="md"
          className="shrink-0"
          onClick={onNavigateToModels}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('addModel')}
        </Button>
      )}
      {req.sourceKind === 'derived' && !req.fulfilled && (
        <span className="shrink-0 text-caption font-medium text-warning">
          {req.count > 0 ? t('derivedCount', { count: req.count }) : t('statusMissing')}
        </span>
      )}
    </li>
  );
}

function LinkExistingDialog({
  projectId,
  open,
  onOpenChange,
  onPick,
  busy,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (attachmentId: string) => void;
  busy: boolean;
}): JSX.Element {
  const t = useTranslations('projectDetail.tabs.dossier');
  // Only fetch the candidate list while the dialog is open.
  const docsQuery = useUnslottedDocuments(projectId, open);
  const docs = docsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('linkDialogTitle')}</DialogTitle>
          <DialogDescription>{t('linkDialogDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {docsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : docs.length === 0 ? (
            <div className="py-6 text-center text-body3 text-foreground-tertiary">
              {t('linkEmpty')}
            </div>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-auto">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { onPick(doc.id); }}
                    className="flex w-full items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-background-hover disabled:opacity-60"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-foreground-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-body3 text-foreground">
                      {doc.original_filename}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
