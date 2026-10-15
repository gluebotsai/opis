import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "../src/db/pool.js";
import { assertExternalAccountContactsAvailable } from "../src/modules/leads/contact-validation.js";
import { findLeadContactConflicts } from "../src/repositories/raw/leads.repo.js";

vi.mock("../src/db/pool.js", () => ({
  query: vi.fn(),
}));

const queryMock = vi.mocked(query);

function queryResult(rows: any[]) {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  };
}

describe("external account contact conflicts", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("passes partner and reseller ignore ids into email conflict checks", async () => {
    queryMock.mockResolvedValueOnce(queryResult([]));

    await findLeadContactConflicts({
      emails: ["new@example.com"],
      phones: [],
      ignorePartnerId: "11111111-1111-1111-1111-111111111111",
      ignoreResellerId: "22222222-2222-2222-2222-222222222222",
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const firstCall = queryMock.mock.calls[0]!;
    expect(firstCall[1]).toEqual([
      ["new@example.com"],
      null,
      null,
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    expect(firstCall[0]).toContain("partner_work_email");
    expect(firstCall[0]).toContain("reseller_invoice_email");
  });

  it("blocks partner or reseller creation when email exists on a customer", async () => {
    queryMock.mockResolvedValueOnce(
      queryResult([{ source: "org_work_email", value: "used@example.com" }]),
    );

    await expect(
      assertExternalAccountContactsAvailable({
        emails: ["used@example.com"],
      }),
    ).rejects.toThrow("This email is already used by a customer.");
  });

  it("blocks partner or reseller creation when mobile exists on another partner", async () => {
    queryMock.mockResolvedValueOnce(
      queryResult([{ source: "partner_mobile", value: "919876543210" }]),
    );

    await expect(
      assertExternalAccountContactsAvailable({
        emails: [],
        mobileCountryCode: "+91",
        mobileNumber: "9876543210",
      }),
    ).rejects.toThrow("This mobile number is already used by a partner.");
  });

  it("allows editing an account while ignoring its own partner id", async () => {
    queryMock.mockResolvedValueOnce(queryResult([]));
    queryMock.mockResolvedValueOnce(queryResult([]));

    await expect(
      assertExternalAccountContactsAvailable(
        {
          emails: ["same-partner@example.com"],
          mobileCountryCode: "+91",
          mobileNumber: "9876543210",
        },
        { ignorePartnerId: "11111111-1111-1111-1111-111111111111" },
      ),
    ).resolves.toBeUndefined();

    expect(queryMock).toHaveBeenCalledTimes(2);
    const emailCall = queryMock.mock.calls[0]!;
    const phoneCall = queryMock.mock.calls[1]!;
    expect((emailCall[1] as any[])[3]).toBe("11111111-1111-1111-1111-111111111111");
    expect((phoneCall[1] as any[])[3]).toBe("11111111-1111-1111-1111-111111111111");
  });
});
