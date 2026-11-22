import { describe, it, expect } from "vitest";
import { mapLegacyPayMethod } from "./pay-method-map";
import { classifyLegacyInvoiceArState } from "./invoice-ar-link";
import { getDefaultLegacyConfig, querySqlcmdJson } from "./mssql-read";

describe("V47 pay_method mapping", () => {
  it("maps PM=3 authoritatively to MASTERCARD and retires PM=8 dlybal", () => {
    const pm3 = mapLegacyPayMethod(3);
    expect(pm3.tenderCode).toBe("MASTERCARD");
    expect(pm3.legacyCcy).toBe("master");

    const pm5 = mapLegacyPayMethod(5);
    expect(pm5.tenderCode).toBe("BANK_XFER");

    const pm8 = mapLegacyPayMethod(8);
    expect(pm8.tenderCode).toBeNull();
    expect(pm8.mode).toBe("retired_dlybal");
  });
});

describe("V47 invoice AR classification", () => {
  it("marks $0 dlybal bills with no non-dlybal payment as unpaid AR invoices", () => {
    expect(
      classifyLegacyInvoiceArState({ netAmountHkd: 48000, nonDlybalPaidHkd: 0, cancelled: false }),
    ).toEqual({
      paymentStatus: "unpaid",
      paidAmountHkd: 0,
      balanceDueHkd: 48000,
    });

    expect(
      classifyLegacyInvoiceArState({ netAmountHkd: 48000, nonDlybalPaidHkd: 10000, cancelled: false }),
    ).toEqual({
      paymentStatus: "partial",
      paidAmountHkd: 10000,
      balanceDueHkd: 38000,
    });

    expect(
      classifyLegacyInvoiceArState({ netAmountHkd: 48000, nonDlybalPaidHkd: 48000, cancelled: false }),
    ).toEqual({
      paymentStatus: "paid",
      paidAmountHkd: 48000,
      balanceDueHkd: 0,
    });
  });

  it("reads lossless Traditional Chinese Big5 rows via sqlcmd FOR JSON PATH (-y 0)", async () => {
    const cfg = getDefaultLegacyConfig();
    const rows = await querySqlcmdJson<{ KY: number; zh: string; en: string }>(
      cfg.server,
      cfg.gsDatabase,
      "SELECT TOP 2 KY, dbo.Encrypt(D1L, 0) AS zh, dbo.Encrypt(D2L, 0) AS en FROM dbo.CustomerData WHERE dbo.Encrypt(TP, 0) = N'PayMethod' AND SN = 0 ORDER BY KY",
    );
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ KY: 0, zh: "現金", en: "Cash" });
    expect(rows[1]).toEqual({ KY: 1, zh: "八達通", en: "Octopus" });
  });

  it("preserves exact datetime strings across large multi-chunk sqlcmd FOR JSON results", async () => {
    const cfg = getDefaultLegacyConfig();
    const rows = await querySqlcmdJson<{ RL: string; HK_STR: string }>(
      cfg.server,
      cfg.gxDatabase,
      "SELECT TOP 400 RTRIM(RL) AS RL, CONVERT(VARCHAR(19), HK, 120) AS HK_STR FROM dbo.HistHeader ORDER BY RL",
    );
    expect(rows.length).toBe(400);
    for (const r of rows) {
      expect(r.HK_STR).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });
});
