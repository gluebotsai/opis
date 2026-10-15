/** Redis key builders for cc-core operational cache. */

const PREFIX = "cc";

function keySegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required for a tenant-scoped Redis key`);
  }
  return encodeURIComponent(normalized);
}

export function organizationRedisKey(
  organizationId: string,
  ...segments: string[]
): string {
  const organization = keySegment(organizationId, "organizationId");
  const suffix = segments.map((segment) => keySegment(segment, "key segment"));
  return [`org:${organization}`, ...suffix].join(":");
}

export function organizationLockKey(
  organizationId: string,
  resource: string,
  ...identifiers: string[]
): string {
  return organizationRedisKey(organizationId, PREFIX, "lock", resource, ...identifiers);
}

export function presenceAgentKey(organizationId: string, agentId: string): string {
  return organizationRedisKey(organizationId, PREFIX, "presence", "agent", agentId);
}

export function presenceUserKey(organizationId: string, userId: string): string {
  return organizationRedisKey(organizationId, PREFIX, "presence", "user", userId);
}

export function presenceReadySetKey(organizationId: string): string {
  return organizationRedisKey(organizationId, PREFIX, "presence", "ready");
}

export function presenceLeaseKey(organizationId: string, agentId: string): string {
  return organizationRedisKey(organizationId, PREFIX, "presence", "lease", agentId);
}

export function presenceOrgAgentsSetKey(organizationId: string): string {
  return organizationRedisKey(organizationId, PREFIX, "presence", "agents");
}

export function umnCallSessionKey(organizationId: string, sessionId: string): string {
  return organizationRedisKey(organizationId, PREFIX, "umn", "call", sessionId);
}

export function umnUserCallSessionKey(organizationId: string, userId: string): string {
  return organizationRedisKey(organizationId, PREFIX, "umn", "call-user", userId);
}

export function transferActionOperationKey(
  organizationId: string,
  operationId: string,
): string {
  return organizationRedisKey(organizationId, PREFIX, "transfer-action", operationId);
}

export function offerGenerationKey(
  organizationId: string,
  userId: string,
): string {
  return organizationRedisKey(organizationId, PREFIX, "offer-generation", userId);
}

export function umnCallStreamCheckpointKey(stream: string): string {
  return `${PREFIX}:umn:call-stream:${stream}:last-id`;
}

export function umnTranscriptStreamCheckpointKey(stream: string): string {
  return `${PREFIX}:umn:transcript-stream:${stream}:last-id`;
}
