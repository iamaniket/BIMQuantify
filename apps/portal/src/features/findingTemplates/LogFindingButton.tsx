'use client';

import { Plus } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import {
  Button,
  SplitButton,
  type ButtonVariant,
  type ControlSize,
  type SplitButtonItem,
} from '@bimdossier/ui';

import { FindingFormDialog } from '@/features/projects/detail/FindingFormDialog';
import type { FindingTemplate, LinkedFileTypeValue } from '@/lib/api/schemas';

import { useFindingTemplates } from './useFindingTemplates';

type Props = {
  projectId: string;
  size?: ControlSize;
  variant?: ButtonVariant;
  // Forwarded to the form when logging from the viewer (#49/#anchor).
  linkedModelId?: string | null;
  linkedFileId?: string | null;
  linkedElementGlobalId?: string | null;
  linkedPoint?: Record<string, number> | null;
  linkedFileType?: LinkedFileTypeValue | null;
};

/**
 * The "Log finding" CTA. When templates exist it renders a split button whose
 * main action opens the org's default template (or the standard form if none),
 * and whose dropdown lets the user pick any template or the standard form.
 * Zero templates → a plain button opening the standard form. Owns the form
 * dialog so every call site is a one-liner.
 */
export function LogFindingButton({
  projectId,
  size = 'sm',
  variant = 'primary',
  linkedModelId,
  linkedFileId,
  linkedElementGlobalId,
  linkedPoint,
  linkedFileType,
}: Props): JSX.Element {
  const t = useTranslations('findingTemplates.picker');
  const { data } = useFindingTemplates();
  const templates = data ?? [];
  const defaultTemplate = templates.find((tpl) => tpl.is_default) ?? null;

  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<FindingTemplate | null>(null);

  const openWith = (tpl: FindingTemplate | null): void => {
    setChosen(tpl);
    setOpen(true);
  };

  const items: SplitButtonItem[] = [
    ...templates.map((tpl) => ({
      id: tpl.id,
      label: tpl.is_default ? `${tpl.name} (${t('defaultSuffix')})` : tpl.name,
      onSelect: () => { openWith(tpl); },
    })),
    { id: '__standard__', label: t('standardForm'), onSelect: () => { openWith(null); } },
  ];

  return (
    <>
      {templates.length > 0 ? (
        <SplitButton
          label={t('logFinding')}
          icon={<Plus className="mr-1 h-3.5 w-3.5" />}
          onClick={() => { openWith(defaultTemplate); }}
          items={items}
          menuLabel={t('menuLabel')}
          variant={variant}
          size={size}
        />
      ) : (
        <Button variant={variant} size={size} onClick={() => { openWith(null); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('logFinding')}
        </Button>
      )}
      <FindingFormDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        template={chosen}
        linkedModelId={linkedModelId ?? null}
        linkedFileId={linkedFileId ?? null}
        linkedElementGlobalId={linkedElementGlobalId ?? null}
        linkedPoint={linkedPoint ?? null}
        linkedFileType={linkedFileType ?? null}
      />
    </>
  );
}
