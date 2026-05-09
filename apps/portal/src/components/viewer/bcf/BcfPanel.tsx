'use client';

import {
  Camera,
  Download,
  MessageSquare,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from 'react';

import { cn } from '@bimstitch/ui';
import type { BcfTopicSummary, ViewerHandle } from '@bimstitch/viewer';

import { PanelEmptyState } from '../PanelEmptyState';

type Props = {
  handle: ViewerHandle | null;
};

const TOPIC_TYPES = ['Issue', 'Request', 'Remark', 'Clash', 'Information'] as const;
const TOPIC_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'] as const;
const TOPIC_PRIORITIES = ['Low', 'Normal', 'High', 'Critical'] as const;

type FormState = {
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
};

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  type: 'Issue',
  status: 'Open',
  priority: 'Normal',
};

function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('closed') || s.includes('resolved')) {
    return 'bg-success-lighter text-success border-success-light';
  }
  if (s.includes('progress')) {
    return 'bg-warning-lighter text-warning border-warning-light';
  }
  return 'bg-primary-lighter text-primary border-primary-light';
}

function priorityClass(priority?: string): string {
  if (!priority) return 'text-foreground-tertiary';
  const p = priority.toLowerCase();
  if (p.includes('critical') || p.includes('high')) return 'text-error';
  if (p.includes('low')) return 'text-foreground-tertiary';
  return 'text-foreground-secondary';
}

export function BcfPanel({ handle }: Props): JSX.Element {
  const [topics, setTopics] = useState<BcfTopicSummary[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [activeGuid, setActiveGuid] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    if (!handle) return;
    handle.commands
      .execute<BcfTopicSummary[]>('bcf.listTopics')
      .then((list) => {
        if (mountedRef.current) setTopics(list ?? []);
      })
      .catch(() => undefined);
  }, [handle]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!handle) return undefined;
    const unsub = handle.events.on('bcf:change', () => {
      refresh();
    });
    return unsub;
  }, [handle, refresh]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!handle || !form.title.trim() || submitting) return;
    setSubmitting(true);
    handle.commands
      .execute<BcfTopicSummary>('bcf.createTopic', {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        type: form.type,
        status: form.status,
        priority: form.priority,
      })
      .then(() => {
        if (!mountedRef.current) return;
        setForm(EMPTY_FORM);
        setIsCreating(false);
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[bcf-panel] createTopic failed:', err);
      })
      .finally(() => {
        if (mountedRef.current) setSubmitting(false);
      });
  };

  const navigate = (guid: string): void => {
    if (!handle) return;
    setActiveGuid(guid);
    handle.commands.execute('bcf.navigateToTopic', { guid }).catch(() => undefined);
  };

  const remove = (guid: string): void => {
    if (!handle) return;
    handle.commands.execute('bcf.deleteTopic', { guid }).catch(() => undefined);
  };

  if (!handle) {
    return <PanelEmptyState icon={MessageSquare} message="Viewer not ready" />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-background-secondary/50 px-3 py-2">
        <span className="text-caption font-medium text-foreground-secondary">
          {topics.length} topic{topics.length === 1 ? '' : 's'}
        </span>
        {!isCreating ? (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="inline-flex items-center gap-1 rounded-md border border-primary-light bg-primary-lighter px-2 py-1 text-caption font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Plus className="h-3.5 w-3.5" />
            New Topic
          </button>
        ) : null}
      </div>

      {isCreating ? (
        <form
          onSubmit={handleSubmit}
          className="flex shrink-0 flex-col gap-2 border-b border-border bg-background-secondary/30 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-caption font-bold uppercase tracking-wider text-foreground-secondary">
              New Topic
            </span>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setForm(EMPTY_FORM);
              }}
              className="text-foreground-tertiary hover:text-foreground"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            type="text"
            required
            autoFocus
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Title"
            className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-foreground-tertiary"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Description (optional)"
            rows={2}
            className="resize-none rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-foreground-tertiary"
          />
          <div className="grid grid-cols-3 gap-2">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="h-8 rounded border border-border bg-background px-1.5 text-xs text-foreground"
              aria-label="Type"
            >
              {TOPIC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="h-8 rounded border border-border bg-background px-1.5 text-xs text-foreground"
              aria-label="Status"
            >
              {TOPIC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              className="h-8 rounded border border-border bg-background px-1.5 text-xs text-foreground"
              aria-label="Priority"
            >
              {TOPIC_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-caption text-foreground-tertiary">
              <Camera className="h-3 w-3" />
              Captures current viewpoint
            </span>
            <button
              type="submit"
              disabled={!form.title.trim() || submitting}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-caption font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {topics.length === 0 && !isCreating ? (
          <PanelEmptyState
            icon={MessageSquare}
            message="No topics yet. Click New Topic to capture the current view, or import a .bcf file from the header."
          />
        ) : (
          <ul className="divide-y divide-border">
            {topics.map((topic) => {
              const isActive = topic.guid === activeGuid;
              return (
                <li
                  key={topic.guid}
                  className={cn(
                    'group cursor-pointer px-3 py-2 transition-colors hover:bg-background-secondary/60',
                    isActive ? 'bg-primary-lighter/40' : '',
                  )}
                  onClick={() => navigate(topic.guid)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">
                        {topic.title}
                      </p>
                      {topic.description ? (
                        <p className="mt-0.5 line-clamp-2 text-caption text-foreground-secondary">
                          {topic.description}
                        </p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                            statusPillClass(topic.status),
                          )}
                        >
                          {topic.status}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-foreground-tertiary">
                          {topic.type}
                        </span>
                        {topic.priority ? (
                          <span
                            className={cn(
                              'text-[10px] uppercase tracking-wide',
                              priorityClass(topic.priority),
                            )}
                          >
                            · {topic.priority}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(topic.guid);
                      }}
                      title="Delete topic"
                      aria-label="Delete topic"
                      className="opacity-0 text-foreground-tertiary transition-opacity hover:text-error group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const headerBtnClass =
  'inline-flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

export function BcfHeaderActions({ handle }: { handle: ViewerHandle | null }): JSX.Element {
  const [topicCount, setTopicCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!handle) return undefined;
    const update = (): void => {
      handle.commands
        .execute<BcfTopicSummary[]>('bcf.listTopics')
        .then((list) => setTopicCount(list?.length ?? 0))
        .catch(() => undefined);
    };
    update();
    const unsub = handle.events.on('bcf:change', update);
    return unsub;
  }, [handle]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const flashError = (msg: string): void => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 4000);
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !handle) return;
    try {
      const data = await file.arrayBuffer();
      await handle.commands.execute('bcf.import', { data });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[bcf] import failed:', err);
      flashError('Could not parse BCF file');
    }
  };

  const handleExport = async (): Promise<void> => {
    if (!handle || topicCount === 0) return;
    try {
      const blob = await handle.commands.execute<Blob>('bcf.export');
      if (!blob) {
        flashError('Export returned no data');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `topics-${Date.now()}.bcf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[bcf] export failed:', err);
      flashError('Export failed');
    }
  };

  if (!handle) return <></>;

  return (
    <>
      {error ? (
        <span
          role="alert"
          className="mr-1 max-w-[160px] truncate text-caption text-error"
          title={error}
        >
          {error}
        </span>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept=".bcf,.bcfzip,application/zip"
        className="hidden"
        onChange={(e) => {
          handleImport(e).catch(() => undefined);
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        title="Import BCF file"
        aria-label="Import BCF"
        className={cn(headerBtnClass, 'text-foreground-secondary')}
      >
        <Upload className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => {
          handleExport().catch(() => undefined);
        }}
        disabled={topicCount === 0}
        title={topicCount === 0 ? 'No topics to export' : 'Export topics as .bcf'}
        aria-label="Export BCF"
        className={cn(headerBtnClass, 'text-foreground-secondary')}
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </>
  );
}
