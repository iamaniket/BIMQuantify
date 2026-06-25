'use client';

import { FileText, Upload } from '@bimdossier/ui/icons';
import {
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { useFormContext } from 'react-hook-form';
import { toast } from 'sonner';

import {
  Input, Label, Textarea,
} from '@bimdossier/ui';

import { useRegisterField } from '@/hooks/useRegisterField';

import {
  fieldErrorClass, fieldLabelClass, getFieldErrorMessage,
} from '@/features/projects/wizard/stepStyles';

import type { BlogFormValues } from '../blogFormSchema';
import { parseFrontmatter } from '../frontmatter';

const MDX_EXTENSIONS = ['.md', '.mdx'];

export type BlogStepDutchProps = {
  isSubmitting: boolean;
  firstFieldRef: RefObject<HTMLInputElement | null> | undefined;
};

export function BlogStepDutch({
  isSubmitting,
  firstFieldRef,
}: BlogStepDutchProps): JSX.Element {
  const t = useTranslations('admin.blog.create');
  const form = useFormContext<BlogFormValues>();
  const titleId = useId();
  const contentId = useId();
  const dropRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const { errors } = form.formState;
  const titleError = getFieldErrorMessage(errors, 'title_nl');
  const contentError = getFieldErrorMessage(errors, 'content_nl');

  const titleRegister = useRegisterField(form, 'title_nl');
  const { setValue } = form;

  const handleMarkdownFile = useCallback(async (file: File) => {
    const text = await file.text();
    const fm = parseFrontmatter(text);
    // NL drop zone fills NL-specific fields only — shared metadata is locked
    // in step 1 and intentionally ignored here even if the .nl.mdx frontmatter
    // carries it.
    if (fm.title !== undefined) setValue('title_nl', fm.title);
    setValue('content_nl', fm.body);
    toast.success(t('toast.parsedFileNl', { filename: file.name }));
  }, [setValue, t]);

  const onDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (MDX_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        // eslint-disable-next-line no-await-in-loop
        await handleMarkdownFile(file);
      } else {
        toast.error(t('errors.unknownDrop', { filename: file.name }));
      }
    }
  }, [handleMarkdownFile, t]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={titleId} className={fieldLabelClass}>
          {t('fields.title')}
        </Label>
        <Input
          id={titleId}
          type="text"
          placeholder={t('placeholders.titleNl')}
          invalid={titleError !== undefined}
          disabled={isSubmitting}
          {...titleRegister}
          ref={(node) => {
            titleRegister.ref(node);
            if (firstFieldRef !== undefined) {
              // eslint-disable-next-line no-param-reassign
              firstFieldRef.current = node;
            }
          }}
        />
        {titleError !== undefined && (
          <span role="alert" className={fieldErrorClass}>{titleError}</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={contentId} className={fieldLabelClass}>
          {t('fields.content')}{' '}
          <span className="text-foreground-tertiary font-normal">
            ({t('fields.optional')} {t('fields.dropMdxHintNl')})
          </span>
        </Label>
        <div
          ref={dropRef}
          role="region"
          aria-label={t('dropzone.aria')}
          className={`flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-2 text-center transition-colors ${
            dragging
              ? 'border-primary bg-primary-lighter'
              : 'border-border bg-surface-low'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => { setDragging(false); }}
          onDrop={(e) => { onDrop(e).catch(() => undefined); }}
        >
          <div className="flex items-center gap-2 text-caption text-foreground-tertiary">
            <Upload className="h-3.5 w-3.5" aria-hidden />
            <span>{t('dropzone.hintNl')}</span>
            <label className="cursor-pointer text-primary hover:underline">
              <input
                type="file"
                accept=".md,.mdx,text/markdown"
                className="hidden"
                onChange={(e) => {
                  const fileList = e.target.files;
                  const file = fileList === null ? undefined : fileList[0];
                  if (file !== undefined) {
                    handleMarkdownFile(file).catch(() => undefined);
                  }
                  e.currentTarget.value = '';
                }}
              />
              <FileText className="mr-1 inline h-3 w-3" />
              {t('dropzone.pickMarkdown')}
            </label>
          </div>
        </div>
        <Textarea
          id={contentId}
          rows={12}
          className="font-sans text-body3 tabular-nums"
          placeholder={t('placeholders.contentNl')}
          invalid={contentError !== undefined}
          disabled={isSubmitting}
          {...useRegisterField(form, 'content_nl')}
        />
        <span className="text-caption text-foreground-tertiary">
          {t('hints.content')}
        </span>
        {contentError !== undefined && (
          <span role="alert" className={fieldErrorClass}>{contentError}</span>
        )}
      </div>
    </div>
  );
}
