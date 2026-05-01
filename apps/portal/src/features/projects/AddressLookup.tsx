'use client';

import { Loader2, MapPin, Search } from 'lucide-react';
import {
  useEffect, useId, useRef, useState, type JSX,
} from 'react';

import { Input, Label } from '@bimstitch/ui';

import {
  lookupAddress, suggestAddresses, type AddressSuggestion, type ResolvedAddress,
} from '@/lib/api/pdok';

const DEBOUNCE_MS = 220;
const MIN_QUERY_LEN = 3;

type Props = {
  onSelect: (address: ResolvedAddress) => void;
  /** Optional initial label to seed the input (e.g., when editing). */
  initialLabel?: string;
  disabled?: boolean;
};

export function AddressLookup({ onSelect, initialLabel, disabled = false }: Props): JSX.Element {
  const inputId = useId();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState(initialLabel ?? '');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Debounced suggest fetch.
  useEffect(() => {
    const trimmed = query.trim();
    if (disabled || trimmed.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setIsLoading(true);
      suggestAddresses(trimmed, ctrl.signal)
        .then((items) => {
          setSuggestions(items);
          setActiveIdx(items.length === 0 ? -1 : 0);
          setOpen(true);
          setErrorMessage(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setSuggestions([]);
          setErrorMessage('Address lookup is currently unavailable.');
        })
        .finally(() => setIsLoading(false));
    }, DEBOUNCE_MS);

    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [disabled, query]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target) === true) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => { document.removeEventListener('mousedown', onDocClick); };
  }, []);

  const handlePick = (suggestion: AddressSuggestion): void => {
    setQuery(suggestion.label);
    setOpen(false);
    setIsLoading(true);
    lookupAddress(suggestion.id)
      .then((addr) => {
        if (addr === null) {
          setErrorMessage('Could not resolve the selected address.');
          return;
        }
        setErrorMessage(null);
        onSelect(addr);
      })
      .catch(() => {
        setErrorMessage('Could not resolve the selected address.');
      })
      .finally(() => setIsLoading(false));
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = suggestions[activeIdx];
      if (picked !== undefined) handlePick(picked);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      <Label htmlFor={inputId} className="text-body3 font-medium text-foreground-secondary">
        Find Dutch address
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
        <Input
          id={inputId}
          type="text"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          placeholder="Start typing street + city, e.g. Damrak 70 Amsterdam"
          disabled={disabled}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          onKeyDown={handleKey}
          className="pl-8 pr-8"
        />
        {isLoading && (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-foreground-tertiary" />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-background shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === activeIdx}
              className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-body3 ${
                i === activeIdx
                  ? 'bg-primary/10 text-foreground'
                  : 'text-foreground-secondary hover:bg-background-secondary'
              }`}
              onMouseDown={(e) => { e.preventDefault(); handlePick(s); }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <MapPin className="h-3 w-3 shrink-0 text-foreground-tertiary" />
              <span className="flex-1 truncate">{s.label}</span>
              <span className="shrink-0 rounded bg-background-secondary px-1.5 py-0.5 text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
                {s.type}
              </span>
            </li>
          ))}
        </ul>
      )}
      {errorMessage !== null && (
        <span role="alert" className="text-body3 text-error">{errorMessage}</span>
      )}
      <p className="text-caption text-foreground-tertiary">
        Powered by PDOK Locatieserver — Dutch addresses only.
      </p>
    </div>
  );
}
