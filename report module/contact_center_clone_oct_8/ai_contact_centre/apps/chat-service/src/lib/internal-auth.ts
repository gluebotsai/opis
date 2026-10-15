function isAuthorized(request: { headers: Record<string, unknown> }): boolean {
  const serviceKey = process.env.INTERNAL_SERVICE_KEY;
  const headerKey = request.headers["x-internal-service-key"];
  return !(serviceKey && headerKey !== serviceKey && process.env.NODE_ENV === "production");
}

export { isAuthorized };
