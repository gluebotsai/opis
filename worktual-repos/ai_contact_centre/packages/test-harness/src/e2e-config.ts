export type E2eServiceConfig = {
  ccCoreUrl: string;
  chatServiceUrl: string;
  socialServiceUrl: string;
  nlpUrl: string;
  webUrl: string;
  internalServiceKey: string | undefined;
  agentEmail: string;
  agentPassword: string;
  metaAppSecret: string;
  whatsappVerifyToken: string;
};

export function loadE2eConfig(): E2eServiceConfig {
  return {
    ccCoreUrl: process.env.CC_CORE_URL ?? process.env.E2E_CC_CORE_URL ?? "http://localhost:3000",
    chatServiceUrl:
      process.env.CHAT_SERVICE_URL ?? process.env.E2E_CHAT_SERVICE_URL ?? "http://localhost:3002",
    socialServiceUrl:
      process.env.SOCIAL_SERVICE_URL ?? process.env.E2E_SOCIAL_SERVICE_URL ?? "http://localhost:3004",
    nlpUrl: process.env.NLP_URL ?? process.env.E2E_NLP_URL ?? "http://localhost:8000",
    webUrl: process.env.PLAYWRIGHT_BASE_URL ?? process.env.E2E_WEB_URL ?? "http://localhost:5173",
    internalServiceKey: process.env.INTERNAL_SERVICE_KEY,
    agentEmail: process.env.PLAYWRIGHT_AGENT_EMAIL ?? process.env.E2E_AGENT_EMAIL ?? "agent.test@worktual.local",
    agentPassword:
      process.env.PLAYWRIGHT_AGENT_PASSWORD ?? process.env.E2E_AGENT_PASSWORD ?? "Worktual@123",
    metaAppSecret:
      process.env.META_WHATSAPP_APP_SECRET ??
      process.env.META_APP_SECRET ??
      process.env.WHATSAPP_APP_SECRET ??
      "meta-app-secret",
    whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "verify-me",
  };
}
