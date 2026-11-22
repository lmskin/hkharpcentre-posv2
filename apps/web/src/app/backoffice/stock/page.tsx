"use client";

import { useRouter } from "next/navigation";
import { StockPanel } from "@/components/StockPanel";

export default function StockBackOfficePage() {
  const router = useRouter();
  return (
    <div className="fixed inset-0 z-40 bg-[#f0f0f0]">
      <StockPanel onClose={() => router.push("/pos")} />
    </div>
  );
}
