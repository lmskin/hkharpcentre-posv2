"use client";

import type { ReactNode } from "react";
import type { SuggestKind } from "@hkharp/db";
import { AutoSuggestInput } from "@/components/AutoSuggestInput";

interface PickerColumn<T> {
  header: string;
  render: (item: T) => ReactNode;
  numeric?: boolean;
}

interface LegacyPickerProps<T> {
  title: string;
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  loading?: boolean;
  suggestKind?: SuggestKind;
  selectedKey?: string | number | null;
  getKey: (item: T) => string | number;
  columns: PickerColumn<T>[];
  headerActions?: ReactNode;
  onQueryChange: (query: string) => void;
  onPageChange: (page: number) => void;
  onSelect: (item: T) => void;
}

export function LegacyPicker<T>({
  title,
  items,
  total,
  page,
  pageSize,
  query,
  loading = false,
  suggestKind,
  selectedKey,
  getKey,
  columns,
  headerActions,
  onQueryChange,
  onPageChange,
  onSelect,
}: LegacyPickerProps<T>) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f0f0f0]">
      {/* Raised VB6 tab strip + optional header actions (matching Screenshots 048-050) */}
      <div className="flex items-end justify-between border-b border-[#808080] bg-[#e6e4dc] px-1 pt-1">
        <div className="border border-b-0 border-[#808080] bg-[#f7f7f5] px-8 py-1 text-[12px] font-normal text-black">
          {title} [{firstItem}/{total}]
        </div>
        {headerActions ? <div className="flex items-center gap-1 pb-1">{headerActions}</div> : null}
      </div>

      {/* Compact search + page navigation */}
      <div className="flex gap-1 border-b border-[#aca899] bg-[#f0f0f0] p-1">
        <AutoSuggestInput
          theme="legacy"
          name={`picker_${title}`}
          autoComplete="on"
          suggestKind={suggestKind}
          historyKey={`picker_${title}`}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={`搜尋${title}…`}
          className="min-w-0 flex-1 border border-[#7f9db9] bg-white px-2 py-0.5 text-[12px]"
        />
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
          className="border border-[#7f9db9] bg-[#f0f0f0] px-2 py-0.5 text-[11px] text-black hover:bg-[#e5e1d5] disabled:opacity-40"
        >
          上一頁
        </button>
        <button
          type="button"
          disabled={page >= pageCount || loading}
          onClick={() => onPageChange(page + 1)}
          className="border border-[#7f9db9] bg-[#f0f0f0] px-2 py-0.5 text-[11px] text-black hover:bg-[#e5e1d5] disabled:opacity-40"
        >
          下一頁
        </button>
      </div>

      {/* Classic beige/cream alternating grid with blue text & active gutter */}
      <div className="min-h-0 flex-1 overflow-auto bg-[#f7f3e3]">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[#808080] bg-[#f0f0f0] text-left text-black">
              <th className="w-4 border-r border-[#c8c8c8] px-1 py-0.5 font-normal" aria-hidden="true" />
              {columns.map((column) => (
                <th
                  key={column.header}
                  className={`border-r border-[#c8c8c8] px-2 py-0.5 font-normal ${column.numeric ? "text-right" : ""}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const key = getKey(item);
              const isSelected = selectedKey === key;
              return (
                <tr
                  key={key}
                  onClick={() => onSelect(item)}
                  className={`cursor-pointer border-b border-[#d9d0b8] ${
                    isSelected
                      ? "bg-[#316ac5] text-white"
                      : idx % 2 === 0
                        ? "bg-[#fcf5e3] text-[#003399] hover:bg-[#eaf3fb]"
                        : "bg-[#f3e3be] text-[#003399] hover:bg-[#eaf3fb]"
                  }`}
                >
                  <td className="border-r border-[#d9d0b8] bg-[#e6e4dc] px-1 py-0.5 text-center text-[10px] text-black">
                    {isSelected || idx === 0 ? "▸" : ""}
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.header}
                      className={`border-r border-[#d9d0b8] px-2 py-0.5 ${column.numeric ? "text-right font-mono" : ""}`}
                    >
                      {column.render(item)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading ? <div className="p-4 text-center text-[12px] text-black">讀取中…</div> : null}
        {!loading && items.length === 0 ? <div className="p-4 text-center text-[12px] text-[#808080]">沒有記錄</div> : null}
      </div>

      <div className="flex items-center justify-between border-t border-[#aca899] bg-[#f0f0f0] px-2 py-0.5 text-[11px] text-black">
        <span>點擊列選取 / 再按取消</span>
        <span>
          頁 {page}/{pageCount}
        </span>
      </div>
    </div>
  );
}
