import type { HttpClient } from "../http.js";
import { TicketingApiError } from "../http.js";
import type { ProposalDecision, ProposalDecisionInput, ProposalListInput, SdkProposal } from "../types.js";

export function createProposalResource(http: HttpClient) {
  return {
    /** Pending confirms and recommendations already produced by Worktual. */
    list(input: ProposalListInput = {}): Promise<{ items: SdkProposal[] }> {
      return http.request({
        method: "GET",
        path: "/api/sdk/proposals",
        auth: "accessToken",
        accessToken: input.sessionToken,
        headers: { "X-Worktual-Sdk-Feature": "ai.proposals.list" },
        query: {
          ticketNumber: input.ticketNumber,
          status: input.status,
        },
      });
    },

    /** Accept or dismiss one proposal. Confirm on an approval runs its tool. */
    async decide(input: ProposalDecisionInput): Promise<ProposalDecision> {
      const id = String(input.id || "").trim();
      if (!/^(approval|recommendation):\d+$/.test(id)) {
        throw new TicketingApiError("Proposal id must look like approval:1 or recommendation:1", 400, null);
      }
      if (input.decision !== "confirm" && input.decision !== "reject") {
        throw new TicketingApiError("decision must be confirm or reject", 400, null);
      }
      const feature = input.decision === "confirm" ? "ai.proposals.confirm" : "ai.proposals.reject";
      return http.request({
        method: "POST",
        path: `/api/sdk/proposals/${encodeURIComponent(id)}/decide`,
        auth: "accessToken",
        accessToken: input.sessionToken,
        headers: { "X-Worktual-Sdk-Feature": feature },
        body: {
          decision: input.decision,
          edits: input.edits,
        },
      });
    },
  };
}

export type ProposalResource = ReturnType<typeof createProposalResource>;
