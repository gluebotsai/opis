import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/dao/db/prisma";

const ACTIVE = ["queued", "preflight", "planning", "pricing", "writing", "qa"];

function db() {
  return getPrismaClient();
}

function runs() {
  const delegate = db().proposalGenerationRun;
  if (!delegate) {
    throw new Error(
      "Prisma client is missing ProposalGenerationRun. From the repo root run: npm run db:generate, apply prisma/migrations/20260924140000_proposal_generation_runs, then restart the API.",
    );
  }
  return delegate;
}

function leaves() {
  const delegate = db().proposalGenerationLeaf;
  if (!delegate) {
    throw new Error(
      "Prisma client is missing ProposalGenerationLeaf. From the repo root run: npm run db:generate and restart the API.",
    );
  }
  return delegate;
}

export async function createProposalGenerationRun(input: {
  organizationId: string;
  dealId: string;
  proposalId: string;
  actorUserId?: string | null;
  inputHash: string;
  requirementText?: string;
  inputJson?: unknown;
  playbookId?: string | null;
}) {
  return runs().create({
    data: {
      organizationId: input.organizationId,
      dealId: input.dealId,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId ?? null,
      inputHash: input.inputHash,
      requirementText: input.requirementText ?? "",
      playbookId: input.playbookId ?? null,
      status: "queued",
      pipelineVersion: 2,
      heartbeatAt: new Date(),
      inputJson: (input.inputJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });
}

export async function findActiveRunByHash(
  organizationId: string,
  inputHash: string,
  dealId?: string,
) {
  return runs().findFirst({
    where: {
      organizationId,
      inputHash,
      ...(dealId ? { dealId } : {}),
      status: { in: [...ACTIVE, "completed"] },
    },
    orderBy: { startedAt: "desc" },
  });
}

export async function listActiveRunProposalIds(dealId?: string) {
  const rows = await runs().findMany({
    where: {
      status: { in: ACTIVE },
      proposalId: { not: null },
      ...(dealId ? { dealId } : {}),
    },
    select: { proposalId: true },
  });
  return rows
    .map((row) => row.proposalId)
    .filter((id): id is string => Boolean(id));
}

export async function getProposalGenerationRun(
  id: string,
  organizationId: string,
) {
  return runs().findFirst({
    where: { id, organizationId },
    include: { leaves: { orderBy: { createdAt: "asc" } } },
  });
}

export async function getRunByProposalId(
  proposalId: string,
  organizationId: string,
) {
  return runs().findFirst({
    where: { proposalId, organizationId },
    include: { leaves: { orderBy: { createdAt: "asc" } } },
    orderBy: { startedAt: "desc" },
  });
}

export async function claimQueuedProposalGenerationRun() {
  const rows = await db().$queryRaw<Array<{ id: string }>>`
    UPDATE "proposal_generation_runs"
    SET status = 'writing',
        claimed_at = NOW(),
        heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM "proposal_generation_runs"
      WHERE status IN ('queued', 'preflight')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY started_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) return null;
  return runs().findUnique({
    where: { id },
    include: { leaves: true },
  });
}

export async function heartbeatProposalGenerationRun(id: string) {
  await runs().update({
    where: { id },
    data: { heartbeatAt: new Date() },
  });
}

export async function markProposalGenerationRun(
  id: string,
  data: Prisma.ProposalGenerationRunUpdateInput,
) {
  return runs().update({ where: { id }, data });
}

export async function upsertProposalGenerationLeaf(input: {
  runId: string;
  leafKey: string;
  title?: string;
  sectionType?: string;
  wave?: number;
  status?: string;
  errorClass?: string | null;
  outputJson?: unknown;
}) {
  return leaves().upsert({
    where: { runId_leafKey: { runId: input.runId, leafKey: input.leafKey } },
    create: {
      runId: input.runId,
      leafKey: input.leafKey,
      title: input.title ?? "",
      sectionType: input.sectionType ?? "",
      wave: input.wave ?? 1,
      status: input.status ?? "pending",
      errorClass: input.errorClass ?? null,
      outputJson: (input.outputJson ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    update: {
      ...(input.title != null ? { title: input.title } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.errorClass !== undefined ? { errorClass: input.errorClass } : {}),
      ...(input.outputJson !== undefined
        ? { outputJson: input.outputJson as Prisma.InputJsonValue }
        : {}),
      attempts: { increment: 1 },
    },
  });
}

export async function reapStaleProposalGenerationRuns(staleMs: number) {
  const cutoff = new Date(Date.now() - staleMs);
  const stale = await runs().findMany({
    where: {
      status: { in: ACTIVE },
      OR: [
        { heartbeatAt: { lt: cutoff } },
        { heartbeatAt: null, startedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, proposalId: true },
  });
  for (const row of stale) {
    await runs().update({
      where: { id: row.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: {
          schemaVersion: 1,
          code: "stale_heartbeat",
          message: "Generate run stopped responding.",
        } as Prisma.InputJsonValue,
      },
    });
    if (row.proposalId) {
      await db()
        .proposal.update({
          where: { id: row.proposalId },
          data: {
            approvalStatus: "failed",
            summary: "Generate stopped responding. Retry to resume.",
          },
        })
        .catch(() => undefined);
    }
  }
  return stale.length;
}
