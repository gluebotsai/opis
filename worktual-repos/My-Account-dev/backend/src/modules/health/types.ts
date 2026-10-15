export interface HealthStatus {
  status: "ok" | "degraded";
  service: "my-accounts-api";
  timestamp: string;
  checks: {
    postgres: "up" | "down";
    redis: "up" | "down" | "disabled";
  };
}
