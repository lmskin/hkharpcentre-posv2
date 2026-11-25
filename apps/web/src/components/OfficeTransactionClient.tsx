"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OfficeTxnPanel } from "@/components/OfficeTxnPanel";
import type { PosProduct } from "@/components/PosRegisterClient";

export function OfficeTransactionClient() {
  const router = useRouter();
  const [products, setProducts] = useState<PosProduct[]>([]);

  async function search(query: string) {
    const res = await fetch(`/api/products?q=${encodeURIComponent(query)}&page=1&pageSize=60`);
    if (!res.ok) return;
    const data = await res.json() as { items: PosProduct[] };
    setProducts(data.items);
  }

  useEffect(() => {
    void search("");
  }, []);

  return (
    <div className="fixed inset-0 z-40 bg-[#f0f0f0]">
      <OfficeTxnPanel
        initialType="GOODS_RECEIPT"
        products={products}
        onSearch={search}
        onClose={() => router.push("/")}
      />
    </div>
  );
}
