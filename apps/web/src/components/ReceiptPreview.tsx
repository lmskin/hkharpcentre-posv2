import { formatHkd } from "@hkharp/domain/money";
import { HarpCentreLogo } from "@/components/LegacyIcons";

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
      address?: string;
      pointsBalance?: number;
    } | null;
  };
  lines: Array<{
    lineNo: number;
    sku: string;
    ubc?: string;
    colorName?: string;
    sizeName?: string;
    nameZh: string;
    nameEn: string;
    categoryC1: number;
    quantity: number;
    unitPriceHkd: number;
    discountRate: number;
    lineTotalHkd: number;
    cancelled: boolean;
    dk: number;
    notes?: string;
    serialNo?: string;
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
  PURCHASE_RETURN: "退貨確認",
  STOCK_TRANSFER_OUT: "轉出",
  STOCK_TRANSFER_IN: "轉入",
  WRITE_OFF: "報銷",
  STOCK_ADJUSTMENT: "調整",
  STOCKTAKE: "盤點",
  CRM_POINT_TXN: "積分調整",
};

export function ReceiptPreview({
  detail,
  deliveryNoteMode = false,
  lang = "TC",
}: {
  detail: ReceiptDetail;
  deliveryNoteMode?: boolean;
  lang?: "TC" | "EN";
}) {
  const { bill } = detail;
  const issuedAt = new Date(bill.issuedAtIso).toLocaleString("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    hour12: false,
  });
  const totalQty = detail.lines.filter((l) => !l.cancelled).reduce((s, l) => s + l.quantity, 0);

  return (
    <div
      className="mx-auto min-h-full w-[310px] bg-white p-4 text-[11px] leading-[1.45] text-black shadow-sm"
      style={{ fontFamily: "'Times New Roman', 'PMingLiU', serif" }}
    >
      <div className="flex flex-col items-start">
        <HarpCentreLogo compact />
      </div>
      <div className="mt-1 text-right font-serif text-[20px] leading-none">
        {deliveryNoteMode ? "Delivery Note" : "Harp Invoice"}
      </div>

      <div className="mt-2 border-t border-black pt-1.5 font-mono text-[10px]">
        <div className="flex justify-between">
          <span>{DOC_LABELS[bill.docType] ?? bill.docType}</span>
          <span>{bill.invoiceNo}</span>
        </div>
        {bill.customer ? (
          <div className="mt-1 font-sans text-[11px]">
            <div>客戶：{bill.customer.nameZh || bill.customer.nameEn} ({bill.customer.legacyId})</div>
            {bill.customer.address ? <div className="text-[10px] text-[#333]">地址：{bill.customer.address}</div> : null}
          </div>
        ) : null}
        <div className="mt-0.5 text-[10px] text-[#444]">日期：{issuedAt}</div>
      </div>

      <div className="my-2 border-t border-black" />

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left font-bold">
            <th className="w-20 pb-1 font-bold">{lang === "TC" ? "貨碼" : "Code"}</th>
            <th className="pb-1 font-bold">{lang === "TC" ? "貨品" : "Item"}</th>
            <th className="pb-1 text-right font-bold">{lang === "TC" ? "金額" : "Amt"}</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr
              key={line.lineNo}
              className={`align-top ${line.cancelled ? "text-[#c00000] line-through" : ""}`}
            >
              <td className="pr-1 font-mono text-[10px]">{line.ubc || line.sku}</td>
              <td className="pr-1">
                <div>
                  {line.nameZh || line.nameEn}
                  {line.colorName ? <span className="ml-1 text-[10px] text-[#444]">({line.colorName})</span> : null}
                </div>
                {line.serialNo ? (
                  <div className="font-mono text-[10px] text-[#222]">S/N: {line.serialNo}</div>
                ) : null}
                {line.notes ? (
                  <div className="whitespace-pre-wrap font-sans text-[10px] text-[#222]">{line.notes}</div>
                ) : null}
                <div className="font-mono text-[10px] text-[#555]">
                  Qty:{line.quantity} @ {formatHkd(line.unitPriceHkd)}
                </div>
              </td>
              <td className="text-right font-mono">{formatHkd(line.lineTotalHkd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {deliveryNoteMode ? (
        <div className="mt-3 border-t border-dashed border-black pt-2 text-[10px]">
          <div className="font-bold">送貨資料：</div>
          <div>銷售單號：{bill.invoiceNo}</div>
          <div>送貨日期：{bill.businessDate}</div>
          {bill.customer?.phone ? <div>電話：{bill.customer.phone}</div> : null}
          {bill.customer?.address ? <div>地址：{bill.customer.address}</div> : null}
          <div>
            提貨狀態：
            {bill.deliveryStatus === "delivered"
              ? "已提貨"
              : bill.deliveryStatus === "rejected"
                ? "已拒收"
                : bill.deliveryStatus === "problem"
                  ? "問題單"
                  : "待提貨"}
          </div>
        </div>
      ) : null}

      <div className="my-2 border-t border-black" />

      <div className="flex items-center justify-between text-[11px]">
        <span>客付</span>
        <span className="font-bold text-[#c00000]">
          {deliveryNoteMode
            ? bill.deliveryStatus === "delivered"
              ? "** 已收 **"
              : "** 待送 **"
            : bill.balanceDueHkd <= 0 && bill.status !== "held"
              ? "** 全數付清 **"
              : "** 留單 **"}
        </span>
        <span>數量: {totalQty}</span>
      </div>

      {!deliveryNoteMode ? (
        <div className="mt-1 space-y-0.5 font-mono text-[10px]">
          <div className="flex justify-between">
            <span>金額</span>
            <span>{formatHkd(bill.grossAmountHkd)}</span>
          </div>
          {bill.discountAmountHkd > 0 ? (
            <div className="flex justify-between">
              <span>折扣</span>
              <span>-{formatHkd(bill.discountAmountHkd)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-[12px] font-bold">
            <span>總計</span>
            <span>{formatHkd(bill.netAmountHkd)}</span>
          </div>
          {detail.payments.map((payment, index) => (
            <div key={`${payment.tenderCode}-${index}`} className="flex justify-between">
              <span>{payment.tenderCode}</span>
              <span>{formatHkd(payment.amountHkd)}</span>
            </div>
          ))}
          {bill.balanceDueHkd > 0 ? (
            <div className="flex justify-between text-[#c00000]">
              <span>未付餘額</span>
              <span>{formatHkd(bill.balanceDueHkd)}</span>
            </div>
          ) : null}
          {bill.deliveryStatus ? (
            <div className="font-sans">
              提貨狀態：
              {bill.deliveryStatus === "delivered"
                ? "已提貨"
                : bill.deliveryStatus === "rejected"
                  ? "已拒收"
                  : bill.deliveryStatus === "problem"
                    ? "問題單"
                    : "待提貨"}
            </div>
          ) : null}
        </div>
      ) : null}

      {bill.notes ? <div className="mt-1 whitespace-pre-wrap font-sans text-[10px]">備註：{bill.notes}</div> : null}

      <div className="my-2 border-t border-black" />
      <div className="text-[9.5px] leading-snug">
        <div>Bank Name: Hang Seng Bank LTD</div>
        <div>Bank Address: Head Office. 83 Des Voeux RoadCentral. H.K.</div>
        <div>Swift Code: HASE HKHH</div>
        <div>Bank Code: 024</div>
        <div>Beneficiary A/C Name: Hong Kong Harp Centre Ltd.</div>
        <div>Beneficiary A/C No.: 395-417017-883</div>
        <div className="mt-1 text-center text-[10px]">
          歡迎再次光臨 · Thank you for your purchase
        </div>
        <div
          className="mt-2 h-10 w-full"
          style={{
            background: "repeating-linear-gradient(90deg,#000 0,#000 2px,#fff 2px,#fff 4px,#000 4px,#000 5px,#fff 5px,#fff 8px)",
          }}
        />
        <div className="mt-1 text-center font-mono tracking-[0.22em]">{bill.invoiceNo}</div>
      </div>
    </div>
  );
}
