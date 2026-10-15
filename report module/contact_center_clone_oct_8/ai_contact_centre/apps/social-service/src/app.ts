import { getPublicPathPrefix, getSocialInternalPaths } from "@ai-contact-center/api-paths";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import type { SocialLoggers } from "./lib/logging.js";

import type { SocialServiceConfig } from "./config.js";
import { MetaMessengerClient } from "./providers/meta-messenger.js";
import { createMetaWhatsAppClient, MetaWhatsAppClient } from "./providers/meta-whatsapp.js";
import { registerMessengerMessageRoutes } from "./routes/messenger-messages.js";
import { registerMessengerWebhookRoutes } from "./routes/messenger-webhooks.js";
import { registerWhatsAppMessageRoutes } from "./routes/messages.js";
import { registerWhatsAppTemplateApprovalRoutes } from "./routes/template-approvals.js";
import { registerWhatsAppWebhookRoutes } from "./routes/webhooks.js";
import { AccountsClient } from "./services/accounts-client.js";
import { WhatsAppCredentialManager } from "./services/credential-manager.js";
import { DirectMessengerCredentialStore } from "./services/direct-messenger-credential-store.js";
import { DirectWhatsAppCredentialStore } from "./services/direct-credential-store.js";
import { MessengerCredentialManager } from "./services/messenger-credential-manager.js";

export type SocialServiceDependencies = {
  accountsClient?: AccountsClient;
  metaClient?: MetaWhatsAppClient;
  credentialManager?: WhatsAppCredentialManager;
  messengerClient?: MetaMessengerClient;
  messengerCredentialManager?: MessengerCredentialManager;
};

export async function buildApp(
  config: SocialServiceConfig,
  loggers: SocialLoggers,
  dependencies: SocialServiceDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(sensible);

  const webhookConfigured = Boolean(config.metaWhatsApp);
  const messengerConfigured = Boolean(config.metaMessenger);
  const credentialStoreConfigured = Boolean(
    config.directCredentialStore || config.accounts,
  );
  const runtimeConfigured = Boolean(
    config.metaWhatsApp?.appSecret && credentialStoreConfigured,
  );
  const messengerRuntimeConfigured = Boolean(
    (config.metaMessenger?.appSecret || config.metaMessenger?.instagramAppSecret) &&
      config.directCredentialStore,
  );

  const healthPayload = {
    status: "ok" as const,
    service: config.serviceName,
    channels: {
      whatsapp: {
        configured: runtimeConfigured,
        webhookConfigured,
        graphApiVersion: config.metaWhatsApp?.graphApiVersion ?? null,
        accountsApiConfigured: Boolean(config.accounts),
        credentialSource: config.directCredentialStore
          ? "accounts_database"
          : config.accounts
            ? "accounts_api"
            : null,
      },
      facebook: {
        configured: messengerRuntimeConfigured,
        webhookConfigured: messengerConfigured,
        graphApiVersion: config.metaMessenger?.graphApiVersion ?? null,
      },
      instagram: {
        configured: messengerRuntimeConfigured,
        webhookConfigured: messengerConfigured,
        graphApiVersion: config.metaMessenger?.graphApiVersion ?? null,
      },
    },
    timestamp: new Date().toISOString(),
  };

  for (const healthPath of getSocialInternalPaths("/health")) {
    app.get(healthPath, async () => ({
      ...healthPayload,
      timestamp: new Date().toISOString(),
    }));
  }

  for (const readyPath of getSocialInternalPaths("/health/ready")) {
    app.get(readyPath, async (_request, reply) => {
      if (!runtimeConfigured && !messengerRuntimeConfigured) {
        return reply.status(503).send({
          status: "not_ready",
          service: config.serviceName,
          reason: "WhatsApp/Messenger app or credential configuration is missing",
          timestamp: new Date().toISOString(),
        });
      }
      return {
        status: "ok" as const,
        service: config.serviceName,
        timestamp: new Date().toISOString(),
      };
    });
  }

  let credentialManager = dependencies.credentialManager ?? null;
  let metaClient: MetaWhatsAppClient | null = null;
  if (config.metaWhatsApp) {
    metaClient =
      dependencies.metaClient ??
      createMetaWhatsAppClient(config.metaWhatsApp, loggers.messages);
    if (!credentialManager && config.directCredentialStore) {
      const store = new DirectWhatsAppCredentialStore(
        config.directCredentialStore,
        config.metaWhatsApp,
      );
      credentialManager = new WhatsAppCredentialManager(
        store,
        config.directCredentialStore,
        loggers.app,
      );
    } else if (!credentialManager && config.accounts) {
      const accountsClient =
        dependencies.accountsClient ?? new AccountsClient(config.accounts);
      credentialManager = new WhatsAppCredentialManager(
        accountsClient,
        config.accounts,
        loggers.app,
      );
    }

    registerWhatsAppWebhookRoutes(
      app,
      config.metaWhatsApp,
      metaClient,
      credentialManager,
      loggers.webhooks,
      loggers.messages,
    );
  }

  let messengerClient: MetaMessengerClient | null = null;
  let messengerCredentialManager: MessengerCredentialManager | null = null;
  if (config.metaMessenger && config.directCredentialStore) {
    messengerClient =
      dependencies.messengerClient ?? new MetaMessengerClient(config.metaMessenger);
    messengerCredentialManager =
      dependencies.messengerCredentialManager ??
      new MessengerCredentialManager(
        new DirectMessengerCredentialStore(
          config.directCredentialStore,
          config.metaMessenger,
        ),
        config.directCredentialStore,
        loggers.app,
      );

    registerMessengerWebhookRoutes(
      app,
      config.metaMessenger,
      messengerClient,
      messengerCredentialManager,
      {
        facebook: loggers.facebook,
        instagram: loggers.instagram,
      },
    );
  }

  const registerInternalRoutes = (instance: FastifyInstance) => {
    if (config.metaWhatsApp && metaClient && credentialManager && config.metaWhatsApp.appSecret) {
      registerWhatsAppMessageRoutes(
        instance,
        metaClient,
        credentialManager,
        config.internalServiceKey,
        loggers.messages,
      );
      registerWhatsAppTemplateApprovalRoutes(
        instance,
        metaClient,
        credentialManager,
        config.internalServiceKey,
        loggers.messages,
      );
    }
    if (
      messengerClient &&
      messengerCredentialManager &&
      (config.metaMessenger?.appSecret || config.metaMessenger?.instagramAppSecret)
    ) {
      registerMessengerMessageRoutes(
        instance,
        messengerClient,
        messengerCredentialManager,
        config.internalServiceKey,
        {
          facebook: loggers.facebook,
          instagram: loggers.instagram,
        },
      );
    }
  };

  registerInternalRoutes(app);
  const publicPrefix = getPublicPathPrefix();
  if (publicPrefix) {
    await app.register(async (scoped) => {
      registerInternalRoutes(scoped);
    }, { prefix: publicPrefix });
  }

  return app;
}
