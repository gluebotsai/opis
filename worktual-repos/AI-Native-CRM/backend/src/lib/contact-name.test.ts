import { describe, expect, it } from "vitest";
import {
  formatContactDisplayName,
  formatContactListLabel,
  hasActionableContactIdentity,
} from "@/lib/contact-name";

describe("contact-name", () => {
  it("formatContactDisplayName returns Unknown without names", () => {
    expect(formatContactDisplayName(null, null)).toBe("Unknown");
  });

  it("hasActionableContactIdentity accepts name or channels", () => {
    expect(hasActionableContactIdentity("Ada", "Lovelace", null, null)).toBe(
      true,
    );
    expect(hasActionableContactIdentity(null, null, "ada@example.com", null)).toBe(
      true,
    );
    expect(hasActionableContactIdentity(null, null, null, "+15551234567")).toBe(
      true,
    );
    expect(hasActionableContactIdentity(null, null, null, null)).toBe(false);
  });

  it("formatContactListLabel falls back to email then phone", () => {
    expect(formatContactListLabel(null, null, "lead@example.com", null)).toBe(
      "lead@example.com",
    );
    expect(formatContactListLabel(null, null, null, "+15551234567")).toBe(
      "+15551234567",
    );
    expect(formatContactListLabel("Ada", "Lovelace", "ada@example.com", null)).toBe(
      "Ada Lovelace",
    );
  });
});
