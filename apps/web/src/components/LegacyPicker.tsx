"use client";

import type { ReactNode } from "react";

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
  selectedKey?: string | number | null;
  getKey: (item: T) => string | number;
  columns: PickerColumn<T>[];
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
  selectedKey,
  getKey,
  columns,
  onQueryChange,
  onPageChange,
  onSelect,
}: LegacyPickerProps<T>) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
        {title} [{firstItem}/{total}]
      </div>
      <div className="flex gap-1 p-1">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={`搜尋${title}…`}
          className="min-w-0 flex-1 border border-[#aca899] bg-white px-2 py-1 text-[12px]"
        />
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
          className="border border-[#aca899] bg-[#f0f0f0] px-2 text-[12px] disabled:opacity-40"
        >
          上一頁
        </button>
        <button
          type="button"
          disabled={page >= pageCount || loading}
          onClick={() => onPageChange(page + 1)}
          className="border border-[#aca899] bg-[#f0f0f0] px-2 text-[12px] disabled:opacity-40"
        >
          下一頁
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0">
            <tr className="bg-[#e8eef5] text-left text-black">
              {columns.map((column) => (
                <th key={column.header} className={`px-2 py-0.5 font-normal ${column.numeric ? "text-right" : ""}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const key = getKey(item);
              return (
                <tr
                  key={key}
                  onClick={() => onSelect(item)}
                  className={`cursor-pointer border-b border-[#e0e0e0] ${selectedKey === key ? "bg-[#316ac5] text-white" : "text-black hover:bg-[#eaf3fb]"}`}
                >
                  {columns.map((column) => (
                    <td key={column.header} className={`px-2 py-1 ${column.numeric ? "text-right font-mono" : ""}`}>
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
      <div className="border-t border-[#d4d0c8] px-2 py-0.5 text-right text-[11px] text-black">
        頁 {page}/{pageCount}
      </div>
    </div>
  );
}
