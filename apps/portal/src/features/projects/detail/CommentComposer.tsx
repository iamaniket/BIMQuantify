'use client';

import { useTranslations } from 'next-intl';
import {
  useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent,
} from 'react';

import { Button, Textarea } from '@bimdossier/ui';

import { UserAvatar } from '@/components/shared/UserAvatar';

import {
  buildCommentText,
  memberDisplayName,
  type MemberLike,
  type PickedMention,
} from './commentMentions';

type Props = {
  members: MemberLike[];
  onSubmit: (text: string) => Promise<void>;
  submitLabel: string;
  placeholder: string;
  /** Display text to seed (edit mode). */
  initialText?: string;
  initialMentions?: PickedMention[];
  /** Render a Cancel button (edit mode). */
  onCancel?: () => void;
  /** Focus the field on mount (edit mode). */
  focusOnMount?: boolean;
};

type ActiveQuery = { start: number; query: string };

const MAX_SUGGESTIONS = 6;

/**
 * Textarea with `@`-mention autocomplete. Shows clean `@Name` display text; the
 * picked mentions are tracked and serialized to canonical `@[Name](uuid)` tokens
 * on submit ({@link buildCommentText}). No overlay — `@Name` reads fine as plain
 * text, and chips are rendered in the posted thread.
 */
export function CommentComposer({
  members,
  onSubmit,
  submitLabel,
  placeholder,
  initialText = '',
  initialMentions = [],
  onCancel,
  focusOnMount = false,
}: Props): JSX.Element {
  const t = useTranslations('findings.detail.comments');
  const [value, setValue] = useState(initialText);
  const [picked, setPicked] = useState<PickedMention[]>(initialMentions);
  const [active, setActive] = useState<ActiveQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (focusOnMount && el !== null) el.focus();
  }, [focusOnMount]);

  const suggestions = useMemo<MemberLike[]>(() => {
    if (active === null) return [];
    const q = active.query.toLowerCase();
    return members
      .filter((m) => memberDisplayName(m).toLowerCase().includes(q)
        || m.email.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }, [active, members]);

  const showSuggestions = active !== null && suggestions.length > 0;

  function detectMention(text: string, caret: number): void {
    const upto = text.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at === -1) {
      setActive(null);
      return;
    }
    const before = at === 0 ? ' ' : upto[at - 1];
    // The `@` must start a word (preceded by start or whitespace)...
    if (before !== undefined && !/\s/.test(before)) {
      setActive(null);
      return;
    }
    const query = upto.slice(at + 1);
    // ...and the query so far must be a single bare token (no whitespace/brackets).
    if (/[\s[\]()]/.test(query)) {
      setActive(null);
      return;
    }
    setActive({ start: at, query });
    setActiveIndex(0);
  }

  function handleChange(text: string, caret: number): void {
    setValue(text);
    detectMention(text, caret);
  }

  function insertMention(member: MemberLike): void {
    if (active === null) return;
    const label = memberDisplayName(member);
    const before = value.slice(0, active.start);
    const after = value.slice(active.start + 1 + active.query.length);
    setValue(`${before}@${label} ${after}`);
    setPicked((prev) => (prev.some((p) => p.userId === member.user_id && p.label === label)
      ? prev
      : [...prev, { label, userId: member.user_id }]));
    setActive(null);
  }

  async function submit(): Promise<void> {
    const display = value.trim();
    if (display.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(buildCommentText(display, picked));
      setValue('');
      setPicked([]);
      setActive(null);
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (showSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const choice = suggestions[activeIndex];
        if (choice !== undefined) {
          e.preventDefault();
          insertMention(choice);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setActive(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit().catch(() => undefined);
    }
  }

  const canSubmit = value.trim().length > 0 && !submitting;

  return (
    <div className="relative flex flex-col gap-2">
      <Textarea
        ref={textareaRef}
        value={value}
        rows={3}
        placeholder={placeholder}
        className="resize-y text-body3"
        onChange={(e) => { handleChange(e.target.value, e.target.selectionStart); }}
        onKeyDown={handleKeyDown}
      />

      {showSuggestions && (
        <ul className="absolute left-0 right-0 top-[4.5rem] z-20 max-h-56 overflow-y-auto rounded-md border border-border bg-surface-main py-1 shadow-lg">
          {suggestions.map((m, i) => (
            <li key={m.user_id}>
              <button
                type="button"
                // Use onMouseDown so the click lands before the textarea blurs.
                onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-body3 ${
                  i === activeIndex ? 'bg-background-hover' : 'hover:bg-background-hover'
                }`}
              >
                <UserAvatar name={memberDisplayName(m)} email={m.email} size="sm" />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {memberDisplayName(m)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" size="md" onClick={onCancel} disabled={submitting}>
            {t('cancel')}
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={() => { submit().catch(() => undefined); }}
          disabled={!canSubmit}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
