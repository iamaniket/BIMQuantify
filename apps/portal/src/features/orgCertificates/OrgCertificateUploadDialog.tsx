'use client';

import { Upload } from '@bimdossier/ui/icons';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@bimdossier/ui';

import type { CertificateTypeValue } from '@/lib/api/schemas';

import { useUploadOrgCertificate } from './useUploadOrgCertificate';

type Props = {
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

export function OrgCertificateUploadDialog({ open, onOpenChange }: Props): JSX.Element {
  const t = useTranslations('orgCertificates.upload');
  const tType = useTranslations('orgCertificates.type');
  const uploadMutation = useUploadOrgCertificate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [certificateType, setCertificateType] = useState<CertificateTypeValue>('product');
  const [productName, setProductName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [certificateNumber, setCertificateNumber] = useState('');
  const [issuer, setIssuer] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const reset = useCallback(() => {
    setFile(null);
    setCertificateType('product');
    setProductName('');
    setSupplierName('');
    setCertificateNumber('');
    setIssuer('');
    setValidFrom('');
    setValidUntil('');
    setDescription('');
    setTagsInput('');
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
  }, []);

  const handleSubmit = useCallback(() => {
    if (file === null) return;
    const tags = tagsInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    uploadMutation.mutate(
      {
        file,
        metadata: {
          certificate_type: certificateType,
          product_name: productName.length > 0 ? productName : null,
          supplier_name: supplierName.length > 0 ? supplierName : null,
          certificate_number: certificateNumber.length > 0 ? certificateNumber : null,
          issuer: issuer.length > 0 ? issuer : null,
          valid_from: validFrom.length > 0 ? validFrom : null,
          valid_until: validUntil.length > 0 ? validUntil : null,
          description: description.length > 0 ? description : null,
          tags: tags.length > 0 ? tags : null,
        },
      },
      {
        onSuccess: (cert) => {
          toast.success(`${cert.original_filename} uploaded`);
          reset();
          onOpenChange(false);
        },
      },
    );
  }, [
    file, certificateType, productName, supplierName,
    certificateNumber, issuer, validFrom, validUntil,
    description, tagsInput, uploadMutation, reset, onOpenChange,
  ]);

  const validityError =
    validFrom.length > 0 && validUntil.length > 0 && validUntil < validFrom;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <Label>{t('fieldFile')}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); }}
              className="mt-1 block w-full text-body3 text-foreground-secondary file:mr-3 file:rounded-md file:border file:border-border file:bg-background-secondary file:px-3 file:py-1.5 file:text-body3 file:text-foreground hover:file:bg-background-hover"
            />
          </div>

          <div>
            <Label>{t('fieldType')}</Label>
            <Select
              selectSize="md"
              value={certificateType}
              onChange={(e) => { setCertificateType(e.target.value as CertificateTypeValue); }}
              className="mt-1"
            >
              {CERTIFICATE_TYPES.map((ct) => (
                <option key={ct} value={ct}>{tType(ct)}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label>{t('fieldProductName')}</Label>
            <Input
              value={productName}
              onChange={(e) => { setProductName(e.target.value); }}
              placeholder={t('fieldProductNamePlaceholder')}
              className="mt-1"
            />
          </div>

          <div>
            <Label>{t('fieldSupplierName')}</Label>
            <Input
              value={supplierName}
              onChange={(e) => { setSupplierName(e.target.value); }}
              placeholder={t('fieldSupplierNamePlaceholder')}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('fieldNumber')}</Label>
              <Input
                value={certificateNumber}
                onChange={(e) => { setCertificateNumber(e.target.value); }}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('fieldIssuer')}</Label>
              <Input
                value={issuer}
                onChange={(e) => { setIssuer(e.target.value); }}
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('fieldValidFrom')}</Label>
              <Input
                type="date"
                value={validFrom}
                onChange={(e) => { setValidFrom(e.target.value); }}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('fieldValidUntil')}</Label>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => { setValidUntil(e.target.value); }}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label>{t('fieldTags')}</Label>
            <Input
              value={tagsInput}
              onChange={(e) => { setTagsInput(e.target.value); }}
              placeholder={t('fieldTagsPlaceholder')}
              className="mt-1"
            />
          </div>

          <div>
            <Label>{t('fieldDescription')}</Label>
            <Textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); }}
              rows={2}
              className="mt-1"
            />
          </div>

        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="md">{t('cancel')}</Button>
          </DialogClose>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={file === null || uploadMutation.isPending || validityError}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
