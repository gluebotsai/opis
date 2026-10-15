export function isInternalRequestAuthorized(request: {
  headers: Record<string, unknown>;
}, serviceKey: string | null): boolean {
  if (!serviceKey) return true;
  const headerKey = request.headers["x-internal-service-key"];
  return typeof headerKey === "string" && headerKey === serviceKey;
}
