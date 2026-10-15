import { describe, expect, it } from "vitest";

import { mergeSentimentAxesForTurn } from "./sentiment-analysis.js";

describe("mergeSentimentAxesForTurn", () => {
  const previous = {
    customer: {
      label: "negative" as const,
      score: 30,
      rationale: "Frustrated",
    },
    agent: {
      label: "positive" as const,
      score: 75,
      rationale: "Polite",
    },
    updatedAt: "now",
  };

  it("updates only customer axis on customer turn", () => {
    const merged = mergeSentimentAxesForTurn(
      "customer",
      {
        customer: { label: "very_negative", score: 15, rationale: "Angry" },
        agent: { label: "neutral", score: 40, rationale: "Ignored" },
      },
      previous,
    );

    expect(merged.customer).toEqual({
      label: "very_negative",
      score: 15,
      rationale: "Angry",
    });
    expect(merged.agent).toEqual(previous.agent);
  });

  it("updates only agent axis on agent turn", () => {
    const merged = mergeSentimentAxesForTurn(
      "agent",
      {
        customer: { label: "positive", score: 80, rationale: "Ignored" },
        agent: { label: "very_positive", score: 90, rationale: "Empathetic" },
      },
      previous,
    );

    expect(merged.customer).toEqual(previous.customer);
    expect(merged.agent).toEqual({
      label: "very_positive",
      score: 90,
      rationale: "Empathetic",
    });
  });
});
