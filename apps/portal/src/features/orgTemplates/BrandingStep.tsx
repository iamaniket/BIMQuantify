'use client';

import { Upload } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { type Dispatch, type RefObject, type SetStateAction, type JSX } from 'react';

import { Badge, Button, Input, Label, Spinner } from '@bimstitch/ui';

type BrandingStepProps = {
  accent: string;
  setAccent: Dispatch<SetStateAction<string>>;
  accentSecondary: string;
  setAccentSecondary: Dispatch<SetStateAction<string>>;
  headerText: string;
  setHeaderText: Dispatch<SetStateAction<string>>;
  footerText: string;
  setFooterText: Dispatch<SetStateAction<string>>;
  logoKey: string | null;
  logoPreview: string | null;
  coverKey: string | null;
  coverName: string | null;
  uploading: 'logo' | 'cover_pdf' | null;
  logoInput: RefObject<HTMLInputElement | null>;
  coverInput: RefObject<HTMLInputElement | null>;
  onUpload: (kind: 'logo' | 'cover_pdf', file: File) => Promise<void>;
};

export function BrandingStep({
  accent,
  setAccent,
  accentSecondary,
  setAccentSecondary,
  headerText,
  setHeaderText,
  footerText,
  setFooterText,
  logoKey,
  logoPreview,
  coverKey,
  coverName,
  uploading,
  logoInput,
  coverInput,
  onUpload,
}: BrandingStepProps): JSX.Element {
  const tReport = useTranslations('reportTemplates');

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rt-accent">{tReport('builder.accentLabel')}</Label>
          <input
            id="rt-accent"
            type="color"
            value={accent}
            onChange={(e) => { setAccent(e.target.value); }}
            className="h-9 w-full cursor-pointer rounded-md border border-border bg-background"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rt-accent2">{tReport('builder.accentSecondaryLabel')}</Label>
          <input
            id="rt-accent2"
            type="color"
            value={accentSecondary}
            onChange={(e) => { setAccentSecondary(e.target.value); }}
            className="h-9 w-full cursor-pointer rounded-md border border-border bg-background"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rt-header">{tReport('builder.headerLabel')}</Label>
        <Input id="rt-header" value={headerText} onChange={(e) => { setHeaderText(e.target.value); }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rt-footer">{tReport('builder.footerLabel')}</Label>
        <Input id="rt-footer" value={footerText} onChange={(e) => { setFooterText(e.target.value); }} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>{tReport('builder.logoLabel')}</Label>
          <input
            ref={logoInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload('logo', f);
            }}
          />
          <Button
            type="button"
            variant="border"
            size="md"
            disabled={uploading !== null}
            onClick={() => logoInput.current?.click()}
          >
            {uploading === 'logo' ? <Spinner className="mr-1.5 h-3 w-3" /> : <Upload className="mr-1.5 h-3 w-3" />}
            {logoKey !== null ? tReport('builder.replace') : tReport('builder.upload')}
          </Button>
          {logoPreview !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoPreview} alt="" className="mt-1 h-10 w-auto self-start rounded border border-border" />
          ) : logoKey !== null ? (
            <Badge variant="success" size="md">{tReport('builder.uploaded')}</Badge>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{tReport('builder.coverLabel')}</Label>
          <input
            ref={coverInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload('cover_pdf', f);
            }}
          />
          <Button
            type="button"
            variant="border"
            size="md"
            disabled={uploading !== null}
            onClick={() => coverInput.current?.click()}
          >
            {uploading === 'cover_pdf' ? <Spinner className="mr-1.5 h-3 w-3" /> : <Upload className="mr-1.5 h-3 w-3" />}
            {coverKey !== null ? tReport('builder.replace') : tReport('builder.upload')}
          </Button>
          {coverName !== null ? (
            <span className="truncate font-sans text-caption text-foreground-tertiary">{coverName}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
