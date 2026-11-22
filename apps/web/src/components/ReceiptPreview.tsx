import { formatHkd } from "@hkharp/domain/money";

export interface ReceiptDetail {
  bill: {
    invoiceNo: string;
    docType: string;
    status: string;
    paymentStatus: string;
    businessDate: string;
    grossAmountHkd: number;
    discountAmountHkd: number;
    netAmountHkd: number;
    paidAmountHkd: number;
    balanceDueHkd: number;
    issuedAtIso: string;
    paidAtIso?: string;
    notes: string | null;
    deliveryStatus: string | null;
    customer: {
      id?: number;
      legacyId: string;
      nameZh: string;
      nameEn: string;
      phone: string;
      pointsBalance?: number;
    } | null;
  };
  lines: Array<{
    lineNo: number;
    sku: string;
    nameZh: string;
    nameEn: string;
    categoryC1: number;
    quantity: number;
    unitPriceHkd: number;
    discountRate: number;
    lineTotalHkd: number;
    cancelled: boolean;
    dk: number;
  }>;
  payments: Array<{
    tenderCode: string;
    amountHkd: number;
    paidAtIso: string;
    approvalCode: string | null;
    cardLast4: string | null;
    referenceNo: string | null;
  }>;
  settings: Record<string, Record<string, unknown>>;
}

const DOC_LABELS: Record<string, string> = {
  RETAIL_SALE: "零售銷售",
  SALES_INVOICE: "銷售發票",
  SALES_RETURN: "退貨",
  PETTY_PAYOUT: "Payout",
  GOODS_RECEIPT: "到貨",
  STOCK_TRANSFER_OUT: "轉出",
  WRITE_OFF: "報銷",
  STOCK_ADJUSTMENT: "調整",
};

export function ReceiptPreview({ detail }: { detail: ReceiptDetail }) {
  const { bill } = detail;
  const issuedAt = new Date(bill.issuedAtIso).toLocaleString("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    hour12: false,
  });

  return (
    <div className="mx-auto min-h-full w-[340px] bg-white p-4 font-mono text-[11px] leading-[1.45] text-black shadow-sm">
      <div className="text-center">
        <div className="font-serif text-[18px] font-bold tracking-wider">HONG KONG HARP CENTRE</div>
        <div>香港豎琴中心</div>
        <div>中環店 · 電話 51 888 902</div>
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between"><span>{DOC_LABELS[bill.docType] ?? bill.docType}</span><span>{bill.invoiceNo}</span></div>
      <div>日期：{issuedAt}</div>
      {bill.customer ? <div>會員：{bill.customer.nameZh || bill.customer.nameEn} ({bill.customer.legacyId})</div> : null}
      <div className="my-2 border-t border-dashed border-black" />
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left"><th className="font-normal">貨品</th><th className="text-right font-normal">數量</th><th className="text-right font-normal">金額</th></tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.lineNo} className="align-top">
              <td className="max-w-[190px] pr-1"><div>{line.nameZh || line.nameEn}</div><div>{line.sku} @ {formatHkd(line.unitPriceHkd)}</div></td>
              <td className="text-right">{line.quantity}</td>
              <td className="text-right">{formatHkd(line.lineTotalHkd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between"><span>金額</span><span>{formatHkd(bill.grossAmountHkd)}</span></div>
      <div className="flex justify-between"><span>折扣</span><span>{formatHkd(bill.discountAmountHkd)}</span></div>
      <div className="flex justify-between text-[14px] font-bold"><span>總計</span><span>{formatHkd(bill.netAmountHkd)}</span></div>
      {detail.payments.map((payment, index) => (
        <div key={`${payment.tenderCode}-${index}`} className="flex justify-between"><span>{payment.tenderCode}</span><span>{formatHkd(payment.amountHkd)}</span></div>
      ))}
      {bill.balanceDueHkd > 0 ? <div className="flex justify-between"><span>未付餘額</span><span>{formatHkd(bill.balanceDueHkd)}</span></div> : null}
      {bill.deliveryStatus ? <div>提貨狀態：{bill.deliveryStatus === "delivered" ? "已提貨" : "待提貨"}</div> : null}
      {bill.notes ? <div className="mt-1 whitespace-pre-wrap">備註：{bill.notes}</div> : null}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">
        <div>恒生銀行戶口：香港豎琴中心</div>
        <div>多謝惠顧 · 貨品出門恕不退換</div>
        <div className="mt-3 h-12 w-full" style={{ background: "repeating-linear-gradient(90deg,#000 0,#000 2px,#fff 2px,#fff 4px,#000 4px,#000 5px,#fff 5px,#fff 8px)" }} />
        <div className="mt-1 tracking-[0.25em]">{bill.invoiceNo}</div>
      </div>
    </div>
  );
}
