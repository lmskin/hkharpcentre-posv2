export type LegacyLanguage = "TC" | "SC" | "ENG";

type MessageTemplate = Record<LegacyLanguage, string>;

const LABEL_MESSAGES: Record<string, MessageTemplate> = {
  "000": {
    TC: "帳單 {invoiceNo} 已完成。\n狀態：{status} · 餘額 {balance}",
    SC: "账单 {invoiceNo} 已完成。\n状态：{status} · 余额 {balance}",
    ENG: "Bill {invoiceNo} completed.\nStatus: {status} · Balance {balance}",
  },
  "017": {
    TC: "{barcode} - 條碼編號不存在，請輸入另一編號！",
    SC: "{barcode} - 条码编号不存在，请输入另一编号！",
    ENG: "{barcode} - Barcode does not exist. Please enter another code.",
  },
  "021": {
    TC: "請先選擇貨品項目！",
    SC: "请先选择货品项目！",
    ENG: "Select a product line first.",
  },
  "022": {
    TC: "帳單沒有貨品項目！",
    SC: "账单没有货品项目！",
    ENG: "The bill has no product lines.",
  },
  "023": {
    TC: "請先用數字鍵輸入有效的新單價！",
    SC: "请先用数字键输入有效的新单价！",
    ENG: "Enter a valid new unit price with the numeric keypad first.",
  },
  "024": {
    TC: "請先輸入條碼或選擇貨品項目！",
    SC: "请先输入条码或选择货品项目！",
    ENG: "Enter a barcode or select a product line first.",
  },
  "025": {
    TC: "{barcode}\n{name}\n單價：{price}",
    SC: "{barcode}\n{name}\n单价：{price}",
    ENG: "{barcode}\n{name}\nUnit price: {price}",
  },
  "026": {
    TC: "此貨品為固定售價 / 不設折扣項目！",
    SC: "此货品为固定售价 / 不设折扣项目！",
    ENG: "This item is fixed-price and does not allow discounts.",
  },
  "044": {
    TC: "會員積分不足或兌換組合無效！",
    SC: "会员积分不足或兑换组合无效！",
    ENG: "Insufficient member points or invalid redemption combination.",
  },
  "100": {
    TC: "此單被八達通 100022 鎖定（卡 {cardId}），請先重拍同一張卡！",
    SC: "此单被八达通 100022 锁定（卡 {cardId}），请先重拍同一张卡！",
    ENG: "This bill is locked by Octopus 100022 (card {cardId}). Tap the same card again.",
  },
  "101": {
    TC: "請先在八達通讀卡器拍卡！",
    SC: "请先在八达通读卡器拍卡！",
    ENG: "Tap the card on the Octopus reader first.",
  },
  "102": {
    TC: "客付現金不足！",
    SC: "客付现金不足！",
    ENG: "Insufficient cash tendered.",
  },
  "401": {
    TC: "請先登入收銀員帳號！",
    SC: "请先登入收银员账号！",
    ENG: "Sign in to a cashier account first.",
  },
  "500": {
    TC: "儲存帳單失敗！",
    SC: "储存账单失败！",
    ENG: "Failed to save the bill.",
  },
  "999": {
    TC: "伺服器離線 — 交易已存入本機離線佇列，稍後重試。",
    SC: "服务器离线 — 交易已存入本机离线队列，稍后重试。",
    ENG: "Server offline — the transaction was saved to the local outbox for retry.",
  },
};

export function formatLegacyMessage(
  code: string,
  language: LegacyLanguage,
  values: Record<string, string | number> = {},
): string {
  const template = LABEL_MESSAGES[code]?.[language] ?? LABEL_MESSAGES[code]?.TC ?? code;
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
