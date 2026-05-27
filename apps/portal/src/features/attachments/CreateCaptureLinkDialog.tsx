'use client';

import { Copy, LinkIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '@bimstitch/ui';

import { useCreateCaptureLink } from './useCreateCaptureLink';

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const TTL_OPTIONS = [
  { value: '24', hours: 24 },
  { value: '72', hours: 72 },
  { value: '168', hours: 168 },
  { value: '720', hours: 720 },
];

export function CreateCaptureLinkDialog({
  projectId,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.attachments');
  const createMutation = useCreateCaptureLink(projectId);

  const [label, setLabel] = useState('');
  const [ttlHours, setTtlHours] = useState('72');
  const [maxUses, setMaxUses] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const handleCreate = useCallback(() => {
    const parsed = parseInt(ttlHours, 10);
    const maxUsesNum = maxUses === '' ? undefined : parseInt(maxUses, 10);
    createMutation.mutate(
      {
        label: label === '' ? null : label,
        ttl_hours: Number.isNaN(parsed) ? 72 : parsed,
        max_uses: maxUsesNum !== undefined && !Number.isNaN(maxUsesNum) ? maxUsesNum : null,
      },
      {
        onSuccess: (data) => {
          setCreatedUrl(data.url);
        },
      },
    );
  }, [createMutation, label, ttlHours, maxUses]);

  const handleCopy = useCallback(() => {
    if (createdUrl !== null) {
      void navigator.clipboard.writeText(createdUrl);
      toast.success(t('captureLinkCopied'));
    }
  }, [createdUrl, t]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setLabel('');
        setTtlHours('72');
        setMaxUses('');
        setCreatedUrl(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('captureLinkTitle')}</DialogTitle>
          <DialogDescription>{t('captureLinkDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {createdUrl === null ? (
            <>
              <div className="space-y-1.5">
                <Label>{t('captureLinkLabel')}</Label>
                <Input
                  value={label}
                  onChange={(e) => { setLabel(e.target.value); }}
                  placeholder={t('captureLinkLabelPlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('captureLinkTtl')}</Label>
                <Select
                  value={ttlHours}
                  onChange={(e) => { setTtlHours(e.target.value); }}
                >
                  {TTL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t('captureLinkTtlHours', { hours: opt.hours })}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('captureLinkMaxUses')}</Label>
                <Input
                  type="number"
                  min={1}
                  value={maxUses}
                  onChange={(e) => { setMaxUses(e.target.value); }}
                  placeholder={t('captureLinkMaxUsesPlaceholder')}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <DialogClose asChild>
                  <Button variant="ghost" size="sm">Cancel</Button>
                </DialogClose>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                >
                  <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
                  {t('captureLinkCreate')}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary p-3">
                <code className="min-w-0 flex-1 truncate text-caption">
                  {createdUrl}
                </code>
                <Button variant="ghost" size="sm" onClick={handleCopy}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex justify-end">
                <DialogClose asChild>
                  <Button variant="primary" size="sm">Done</Button>
                </DialogClose>
              </div>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
