'use client';

import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type JSX } from 'react';
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
  Textarea,
} from '@bimstitch/ui';

import type { CertificateMetadataInput } from '@/lib/api/certificates';
import type { CertificateTypeValue } from '@/lib/api/schemas';
import { useUploadCertificate } from '@/features/certificates/useUploadCertificate';

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const CERTIFICATE_TYPES: CertificateTypeValue[] = [
  'product',
  'installation_test',
  'inspection',
  'warranty',
  'other',
];

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.xlsx';

export function CertificateUploadDialog({
  projectId,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.certificates');
  const uploadMutation = useUploadCertificate(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [certificateType, setCertificateType] = useState<CertificateTypeValue>('product');
  const [certificateNumber, setCertificateNumber] = useState('');
  const [issuer, setIssuer] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [description, setDescription] = useState('');

  const reset = useCallback(() => {
    setFile(null);
    setCertificateType('product');
    setCertificateNumber('');
    setIssuer('');
    setValidFrom('');
    setValidUntil('');
    setDescription('');
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
  }, []);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset],
  );

  const validityInvalid =
    validFrom !== '' && validUntil !== '' && validUntil < validFrom;

  const handleUpload = useCallback(() => {
    if (file === null || validityInvalid) return;
    const metadata: CertificateMetadataInput = {
      certificate_type: certificateType,
      certificate_number: certificateNumber === '' ? null : certificateNumber,
      issuer: issuer === '' ? null : issuer,
      valid_from: validFrom === '' ? null : validFrom,
      valid_until: validUntil === '' ? null : validUntil,
      description: description === '' ? null : description,
    };
    uploadMutation.mutate(
      { file, metadata },
      {
        onSuccess: () => {
          toast.success(t('uploadSuccess', { name: file.name }));
          handleClose(false);
        },
      },
    );
  }, [
    file,
    validityInvalid,
    certificateType,
    certificateNumber,
    issuer,
    validFrom,
    validUntil,
    description,
    uploadMutation,
    t,
    handleClose,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('uploadTitle')}</DialogTitle>
          <DialogDescription>{t('uploadDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('fieldFile')}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); }}
              className="block w-full text-body3 text-foreground-secondary file:mr-3 file:rounded-md file:border file:border-border file:bg-background-secondary file:px-3 file:py-1.5 file:text-body3 file:text-foreground hover:file:bg-background-hover"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('fieldType')}</Label>
            <Select
              value={certificateType}
              onChange={(e) => { setCertificateType(e.target.value as CertificateTypeValue); }}
            >
              {CERTIFICATE_TYPES.map((value) => (
                <option key={value} value={value}>{t(`type.${value}`)}</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('fieldNumber')}</Label>
              <Input
                value={certificateNumber}
                onChange={(e) => { setCertificateNumber(e.target.value); }}
                placeholder={t('fieldNumberPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('fieldIssuer')}</Label>
              <Input
                value={issuer}
                onChange={(e) => { setIssuer(e.target.value); }}
                placeholder={t('fieldIssuerPlaceholder')}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('fieldValidFrom')}</Label>
              <Input
                type="date"
                value={validFrom}
                onChange={(e) => { setValidFrom(e.target.value); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('fieldValidUntil')}</Label>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => { setValidUntil(e.target.value); }}
              />
            </div>
          </div>
          {validityInvalid && (
            <p className="text-caption text-error">{t('validityError')}</p>
          )}
          <div className="space-y-1.5">
            <Label>{t('fieldDescription')}</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => { setDescription(e.target.value); }}
              placeholder={t('fieldDescriptionPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm">{t('cancel')}</Button>
            </DialogClose>
            <Button
              variant="primary"
              size="sm"
              onClick={handleUpload}
              disabled={file === null || validityInvalid || uploadMutation.isPending}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {t('uploadButton')}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
