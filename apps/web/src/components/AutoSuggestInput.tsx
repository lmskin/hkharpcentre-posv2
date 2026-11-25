"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import type { SuggestKind } from "@hkharp/db";

export type SuggestValueField =
  | "sku"
  | "ubc"
  | "nameZh"
  | "nameEn"
  | "phone"
  | "email"
  | "legacyId"
  | "cardNo"
  | "invoiceNo";

export interface SuggestionItem {
  value: string;
  label: string;
  sublabel?: string;
  fields?: Record<string, string>;
  source?: "history" | "db" | "preset" | "email";
}

export type SuggestionInputItem =
  | string
  | {
      value: string;
      label?: string;
      sublabel?: string;
      fields?: Record<string, string>;
    };

export interface AutoSuggestExtraProps {
  suggestKind?: SuggestKind;
  valueField?: SuggestValueField;
  suggestions?: SuggestionInputItem[];
  historyKey?: string;
  emailDomainSuggest?: boolean;
  minChars?: number;
  theme?: "legacy" | "modern";
  onValueSelect?: (value: string, item: SuggestionItem) => void;
}

const HISTORY_PREFIX = "hkharp_suggest_v1:";
const EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com.hk",
  "hotmail.com",
  "icloud.com",
  "outlook.com",
  "hkharpcentre.com",
];

const suggestCache = new Map<string, { ts: number; items: SuggestionItem[] }>();
const CACHE_TTL_MS = 15_000;

function readHistory(historyKey?: string): string[] {
  if (!historyKey || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${HISTORY_PREFIX}${historyKey}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  } catch {
    return [];
  }
}

function saveHistory(historyKey: string | undefined, value: string) {
  const clean = value.trim();
  if (!historyKey || !clean || clean.length < 2 || typeof window === "undefined") return;
  try {
    const existing = readHistory(historyKey).filter((x) => x !== clean);
    localStorage.setItem(`${HISTORY_PREFIX}${historyKey}`, JSON.stringify([clean, ...existing].slice(0, 10)));
  } catch {
    // ignore storage quota errors
  }
}

function normalizeStatic(items?: SuggestionInputItem[]): SuggestionItem[] {
  if (!items || items.length === 0) return [];
  return items.map((item) =>
    typeof item === "string"
      ? { value: item, label: item, source: "preset" as const }
      : {
          value: item.value,
          label: item.label ?? item.value,
          sublabel: item.sublabel,
          fields: item.fields,
          source: "preset" as const,
        },
  );
}

function buildEmailSuggestions(rawValue: string): SuggestionItem[] {
  const clean = rawValue.trim();
  if (!clean) return [];
  const atIdx = clean.indexOf("@");
  const local = atIdx >= 0 ? clean.slice(0, atIdx) : clean;
  if (!local) return [];
  const domainQuery = atIdx >= 0 ? clean.slice(atIdx + 1).toLowerCase() : "";
  return EMAIL_DOMAINS.filter((d) => !domainQuery || d.startsWith(domainQuery)).map((domain) => {
    const full = `${local}@${domain}`;
    return { value: full, label: full, sublabel: "電郵自動完成", source: "email" as const };
  });
}

function useAutoSuggestCore({
  rawValue,
  suggestKind,
  valueField,
  suggestions,
  historyKey,
  emailDomainSuggest,
  minChars = 0,
  disabled,
}: AutoSuggestExtraProps & { rawValue: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dbItems, setDbItems] = useState<SuggestionItem[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  }>({ left: 0, width: 220, top: 0, maxHeight: 220 });

  const elRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = () => {
    const el = elRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < 200 && spaceAbove > 200) {
      setCoords({
        left,
        width,
        bottom: window.innerHeight - rect.top + 2,
        maxHeight: Math.min(240, Math.max(100, spaceAbove - 8)),
      });
    } else {
      setCoords({
        left,
        width,
        top: rect.bottom + 2,
        maxHeight: Math.min(240, Math.max(100, spaceBelow - 8)),
      });
    }
  };

  useEffect(() => {
    if (!open || disabled) return;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, disabled, rawValue]);

  useEffect(() => {
    if (!open || disabled || !suggestKind) {
      if (!suggestKind) setDbItems([]);
      return;
    }
    const q = rawValue.trim();
    if (q.length < minChars) {
      setDbItems([]);
      return;
    }

    const cacheKey = `${suggestKind}::${q}`;
    const cached = suggestCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setDbItems(cached.items);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/suggest?kind=${encodeURIComponent(suggestKind)}&q=${encodeURIComponent(q)}&limit=10`)
        .then(async (res) => {
          if (!res.ok) return [];
          const body = (await res.json()) as { suggestions?: SuggestionItem[] };
          return Array.isArray(body.suggestions) ? body.suggestions.map((s) => ({ ...s, source: "db" as const })) : [];
        })
        .then((items) => {
          suggestCache.set(cacheKey, { ts: Date.now(), items });
          if (!cancelled) setDbItems(items);
        })
        .catch(() => {
          if (!cancelled) setDbItems([]);
        });
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, disabled, suggestKind, rawValue, minChars]);

  const mergedOptions = useMemo(() => {
    const q = rawValue.trim();
    if (disabled || q.length < minChars) return [];
    const ql = q.toLowerCase();

    const out: SuggestionItem[] = [];
    const seen = new Set<string>();
    const pushUnique = (item: SuggestionItem) => {
      const targetVal =
        valueField && item.fields?.[valueField] ? item.fields[valueField] : item.value;
      const dedupeKey = `${targetVal}::${item.label}`;
      if (!targetVal || seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      out.push({ ...item, value: targetVal });
    };

    const hist = readHistory(historyKey);
    for (const h of hist) {
      if (!ql || h.toLowerCase().includes(ql)) {
        pushUnique({ value: h, label: h, sublabel: "最近輸入", source: "history" });
      }
    }

    if (emailDomainSuggest) {
      for (const em of buildEmailSuggestions(rawValue)) {
        pushUnique(em);
      }
    }

    for (const item of dbItems) {
      pushUnique(item);
    }

    for (const st of normalizeStatic(suggestions)) {
      const matchText = `${st.value} ${st.label} ${st.sublabel ?? ""}`.toLowerCase();
      if (!ql || matchText.includes(ql)) {
        pushUnique(st);
      }
    }

    return out.slice(0, 12);
  }, [rawValue, minChars, disabled, historyKey, emailDomainSuggest, dbItems, suggestions, valueField, historyVersion]);

  const recordHistory = (val: string) => {
    saveHistory(historyKey, val);
    setHistoryVersion((v) => v + 1);
  };

  return {
    open,
    setOpen,
    activeIndex,
    setActiveIndex,
    mergedOptions,
    mounted,
    coords,
    elRef,
    listRef,
    updatePosition,
    recordHistory,
  };
}

function SuggestionPortal({
  mounted,
  open,
  options,
  activeIndex,
  setActiveIndex,
  coords,
  theme,
  listRef,
  onPick,
}: {
  mounted: boolean;
  open: boolean;
  options: SuggestionItem[];
  activeIndex: number;
  setActiveIndex: (idx: number) => void;
  coords: { left: number; width: number; top?: number; bottom?: number; maxHeight: number };
  theme: "legacy" | "modern";
  listRef: React.RefObject<HTMLUListElement | null>;
  onPick: (item: SuggestionItem) => void;
}) {
  if (!mounted || !open || options.length === 0 || typeof document === "undefined") {
    return null;
  }

  const boxClass =
    theme === "modern"
      ? "print-hide fixed z-[120] overflow-auto rounded-lg border border-slate-300 bg-white py-1 text-xs shadow-lg"
      : "print-hide fixed z-[120] overflow-auto border border-[#7f9db9] bg-white text-[12px] text-black shadow-md";

  return createPortal(
    <ul
      ref={listRef}
      role="listbox"
      className={boxClass}
      style={{
        left: coords.left,
        width: coords.width,
        top: coords.top,
        bottom: coords.bottom,
        maxHeight: coords.maxHeight,
      }}
    >
      {options.map((opt, idx) => {
        const isActive = idx === activeIndex;
        const badgeText =
          opt.source === "history"
            ? "紀錄"
            : opt.source === "email"
              ? "電郵"
              : opt.source === "preset"
                ? "預設"
                : null;
        const rowClass =
          theme === "modern"
            ? `flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 ${
                isActive ? "bg-indigo-600 text-white" : "text-slate-800 hover:bg-slate-100"
              }`
            : `flex cursor-pointer items-center justify-between gap-2 border-b border-[#ececec] px-2 py-1 ${
                isActive ? "bg-[#316ac5] text-white" : "text-black hover:bg-[#e8eef5]"
              }`;
        return (
          <li
            key={`${opt.value}-${opt.label}-${idx}`}
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => setActiveIndex(idx)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(opt);
            }}
            className={rowClass}
          >
            <div className="min-w-0 flex-1 truncate">
              <span className="font-mono font-medium">{opt.value}</span>
              {opt.label && opt.label !== opt.value ? (
                <span className={`ml-1.5 ${isActive ? "opacity-90" : "opacity-75"}`}>{opt.label}</span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {opt.sublabel ? (
                <span className={`max-w-28 truncate text-[10px] ${isActive ? "opacity-90" : "text-[#666]"}`}>
                  {opt.sublabel}
                </span>
              ) : null}
              {badgeText ? (
                <span
                  className={`border px-1 text-[10px] ${
                    isActive
                      ? "border-white/50 text-white"
                      : theme === "modern"
                        ? "rounded border-slate-200 bg-slate-50 text-slate-500"
                        : "border-[#aca899] bg-[#f4f7fa] text-[#555]"
                  }`}
                >
                  {badgeText}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>,
    document.body,
  );
}

export type AutoSuggestInputProps = InputHTMLAttributes<HTMLInputElement> & AutoSuggestExtraProps;

export function AutoSuggestInput({
  suggestKind,
  valueField,
  suggestions,
  historyKey,
  emailDomainSuggest,
  minChars = 0,
  theme = "legacy",
  onValueSelect,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  autoComplete = "on",
  type = "text",
  value,
  ...rest
}: AutoSuggestInputProps) {
  const rawValue = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  const core = useAutoSuggestCore({
    rawValue,
    suggestKind,
    valueField,
    suggestions,
    historyKey,
    emailDomainSuggest,
    minChars,
    disabled: rest.disabled || rest.readOnly,
  });

  function pickOption(item: SuggestionItem) {
    core.recordHistory(item.value);
    if (onChange) {
      const synthetic = {
        target: { value: item.value, name: rest.name ?? "" },
        currentTarget: { value: item.value, name: rest.name ?? "" },
      } as ChangeEvent<HTMLInputElement>;
      onChange(synthetic);
    }
    onValueSelect?.(item.value, item);
    core.setOpen(false);
    core.setActiveIndex(-1);
  }

  return (
    <>
      <input
        ref={(node) => {
          core.elRef.current = node;
        }}
        {...rest}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-autocomplete="list"
        aria-expanded={core.open && core.mergedOptions.length > 0}
        onFocus={(e: FocusEvent<HTMLInputElement>) => {
          core.updatePosition();
          core.setOpen(true);
          core.setActiveIndex(-1);
          onFocus?.(e);
        }}
        onBlur={(e: FocusEvent<HTMLInputElement>) => {
          if (type !== "password") core.recordHistory(e.currentTarget.value);
          core.setOpen(false);
          core.setActiveIndex(-1);
          onBlur?.(e);
        }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          core.updatePosition();
          core.setOpen(true);
          core.setActiveIndex(-1);
          onChange?.(e);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          const opts = core.mergedOptions;
          if (e.key === "ArrowDown") {
            if (!core.open) {
              core.updatePosition();
              core.setOpen(true);
              if (opts.length > 0) core.setActiveIndex(0);
              e.preventDefault();
            } else if (opts.length > 0) {
              core.setActiveIndex((core.activeIndex + 1) % opts.length);
              e.preventDefault();
            }
          } else if (e.key === "ArrowUp") {
            if (core.open && opts.length > 0) {
              core.setActiveIndex((core.activeIndex - 1 + opts.length) % opts.length);
              e.preventDefault();
            }
          } else if (e.key === "Escape") {
            core.setOpen(false);
            core.setActiveIndex(-1);
          } else if (e.key === "Tab") {
            if (type !== "password") core.recordHistory(e.currentTarget.value);
            core.setOpen(false);
            core.setActiveIndex(-1);
          } else if (e.key === "Enter") {
            if (core.open && core.activeIndex >= 0 && opts[core.activeIndex]) {
              e.preventDefault();
              pickOption(opts[core.activeIndex]!);
              return;
            }
            if (type !== "password") core.recordHistory(e.currentTarget.value);
            core.setOpen(false);
            core.setActiveIndex(-1);
          }
          onKeyDown?.(e);
        }}
      />
      <SuggestionPortal
        mounted={core.mounted}
        open={core.open}
        options={core.mergedOptions}
        activeIndex={core.activeIndex}
        setActiveIndex={core.setActiveIndex}
        coords={core.coords}
        theme={theme}
        listRef={core.listRef}
        onPick={pickOption}
      />
    </>
  );
}

export type AutoSuggestTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & AutoSuggestExtraProps;

export function AutoSuggestTextarea({
  suggestKind,
  valueField,
  suggestions,
  historyKey,
  emailDomainSuggest,
  minChars = 0,
  theme = "modern",
  onValueSelect,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  autoComplete = "on",
  value,
  ...rest
}: AutoSuggestTextareaProps) {
  const rawValue = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  const core = useAutoSuggestCore({
    rawValue,
    suggestKind,
    valueField,
    suggestions,
    historyKey,
    emailDomainSuggest,
    minChars,
    disabled: rest.disabled || rest.readOnly,
  });

  function pickOption(item: SuggestionItem) {
    core.recordHistory(item.value);
    if (onChange) {
      const synthetic = {
        target: { value: item.value, name: rest.name ?? "" },
        currentTarget: { value: item.value, name: rest.name ?? "" },
      } as ChangeEvent<HTMLTextAreaElement>;
      onChange(synthetic);
    }
    onValueSelect?.(item.value, item);
    core.setOpen(false);
    core.setActiveIndex(-1);
  }

  return (
    <>
      <textarea
        ref={(node) => {
          core.elRef.current = node;
        }}
        {...rest}
        value={value}
        autoComplete={autoComplete}
        aria-autocomplete="list"
        aria-expanded={core.open && core.mergedOptions.length > 0}
        onFocus={(e: FocusEvent<HTMLTextAreaElement>) => {
          core.updatePosition();
          core.setOpen(true);
          core.setActiveIndex(-1);
          onFocus?.(e);
        }}
        onBlur={(e: FocusEvent<HTMLTextAreaElement>) => {
          core.recordHistory(e.currentTarget.value);
          core.setOpen(false);
          core.setActiveIndex(-1);
          onBlur?.(e);
        }}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
          core.updatePosition();
          core.setOpen(true);
          core.setActiveIndex(-1);
          onChange?.(e);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          const opts = core.mergedOptions;
          if (e.key === "ArrowDown") {
            if (!core.open) {
              core.updatePosition();
              core.setOpen(true);
              if (opts.length > 0) core.setActiveIndex(0);
              e.preventDefault();
            } else if (opts.length > 0) {
              core.setActiveIndex((core.activeIndex + 1) % opts.length);
              e.preventDefault();
            }
          } else if (e.key === "ArrowUp") {
            if (core.open && opts.length > 0) {
              core.setActiveIndex((core.activeIndex - 1 + opts.length) % opts.length);
              e.preventDefault();
            }
          } else if (e.key === "Escape") {
            core.setOpen(false);
            core.setActiveIndex(-1);
          } else if (e.key === "Enter" && core.open && core.activeIndex >= 0 && opts[core.activeIndex]) {
            e.preventDefault();
            pickOption(opts[core.activeIndex]!);
            return;
          }
          onKeyDown?.(e);
        }}
      />
      <SuggestionPortal
        mounted={core.mounted}
        open={core.open}
        options={core.mergedOptions}
        activeIndex={core.activeIndex}
        setActiveIndex={core.setActiveIndex}
        coords={core.coords}
        theme={theme}
        listRef={core.listRef}
        onPick={pickOption}
      />
    </>
  );
}
