import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAssistQueryFromRecent,
  repairAssistQueryAgainstCatalog,
  scoreQueryCandidate,
} from "./meeting-assist-questions";

const TENANT_PRODUCTS = ["CCaaS", "CVM", "Cognitive CDP", "Lola"];

describe("meeting-assist-questions", () => {
  it("scores named-module asks above generic product overview for tenant catalog", () => {
    const overview = scoreQueryCandidate(
      "What are the products you have?",
      TENANT_PRODUCTS,
    );
    const cvm = scoreQueryCandidate(
      "Can you explain about CVM in detail?",
      TENANT_PRODUCTS,
    );
    assert.ok(cvm > overview, `expected CVM (${cvm}) > overview (${overview})`);
  });

  it("prefers latest CVM follow-up over older product overview", () => {
    const q = buildAssistQueryFromRecent(
      ["Hello!", "What are the products you have?"],
      "Can you explain about CVM in detail?",
      TENANT_PRODUCTS,
    );
    assert.match(q, /CVM/i);
  });

  it("repairs AAC cars using tenant catalog (not hardcoded vendor list)", () => {
    const q = repairAssistQueryAgainstCatalog(
      "Can you tell about AAC cars?",
      TENANT_PRODUCTS,
    );
    assert.match(q, /CCaaS/i);
    assert.doesNotMatch(q, /AAC cars/i);
  });

  it("does not invent Worktual products for an unrelated tenant catalog", () => {
    const q = repairAssistQueryAgainstCatalog("Can you tell about AAC cars?", [
      "Fleet Tracker",
      "Dispatch Pro",
    ]);
    // No close catalog match → leave STT text as-is (no forced CCaaS).
    assert.match(q, /AAC cars/i);
    assert.doesNotMatch(q, /CCaaS/i);
  });

  it("maps STT garble only when a catalog product is close", () => {
    const q = buildAssistQueryFromRecent(
      ["What are the products you have?"],
      "Can you tell about AAC cars?",
      TENANT_PRODUCTS,
    );
    assert.match(q, /CCaaS/i);
  });
});
