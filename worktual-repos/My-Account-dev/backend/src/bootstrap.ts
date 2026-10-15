import { migrateDatabase } from "./db/migrate.js";
import { shouldRunMigrationsOnBoot } from "./infra/env.js";
import { QUEUE_NAMES, setInlineProcessors } from "./infra/queues.js";
import { preloadImapSessions } from "./modules/mail/imap-session.js";
import {
  processBillingSweepJob,
  processEmailJob,
  processMailSyncJob,
  processPaymentFulfillmentJob,
} from "./jobs/production-handlers.js";
import { getMailConfigStatus, verifySmtpConnection } from "./modules/mail/mail-runtime.js";
import {
  getMicrosoftOAuthDiagnostics,
  isMicrosoftMailConfigured,
} from "./modules/mail/ms-graph/config.js";
import { cleanupExpiredOAuthStates } from "./modules/mail/ms-graph/oauth.js";
import { getPaymentConfig } from "./modules/payments/runtime-service.js";
import { startGatewayPaymentRecovery } from "./modules/payments/recovery.js";

export async function prepareServer(): Promise<void> {
  setInlineProcessors({
    [QUEUE_NAMES.EMAIL]: processEmailJob,
    [QUEUE_NAMES.PAYMENT]: processPaymentFulfillmentJob,
    [QUEUE_NAMES.BILLING]: processBillingSweepJob,
    [QUEUE_NAMES.MAIL]: processMailSyncJob,
  });

  if (!shouldRunMigrationsOnBoot()) {
    console.log(
      "[db] Skipping migrations on boot (SKIP_MIGRATE_ON_BOOT=true).",
    );
    return;
  }

  await migrateDatabase();
}

export async function startBackgroundServices(): Promise<void> {
  if (isMicrosoftMailConfigured()) {
    const setup = getMicrosoftOAuthDiagnostics();
    console.log(
      "[mail oauth] Microsoft Graph OAuth enabled — users connect Outlook from the Inbox.",
    );
    console.log(`[mail oauth] Tenant mode: ${setup.tenantMode} (${setup.tenantId})`);
    console.log(`[mail oauth] Authorize endpoint: ${setup.authorizeEndpoint}`);
    for (const hint of setup.hints) {
      console.warn(`[mail oauth] ${hint}`);
    }
    await cleanupExpiredOAuthStates();
  }

  for (const profile of ["sales", "finance", "sales_admin"]) {
    const status = getMailConfigStatus(profile);
    for (const warning of status.warnings || []) {
      console.warn(`[mail config:${profile}] ${warning}`);
    }

    if (!status.smtpConfigured) {
      console.warn(`[mail config:${profile}] SMTP is not configured.`);
      continue;
    }

    try {
      await verifySmtpConnection(profile);
      console.log(
        `[mail config:${profile}] SMTP connection verified (${status.mailboxEmail}).`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[mail config:${profile}] SMTP verification failed: ${message}`);
    }
  }

  const paymentConfig = getPaymentConfig();
  if (paymentConfig.stripeConfigured && !paymentConfig.stripeWebhookConfigured) {
    console.warn(
      "[payments] STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing. Stripe checkouts will not auto-confirm until the webhook signing secret is configured.",
    );
  } else if (
    paymentConfig.stripeConfigured &&
    paymentConfig.stripeWebhookConfigured
  ) {
    console.log("[payments] Stripe API + webhook signing secret configured.");
  }

  if (
    paymentConfig.razorpayConfigured &&
    !paymentConfig.razorpayWebhookConfigured
  ) {
    console.warn(
      "[payments] Razorpay keys are set but RAZORPAY_WEBHOOK_SECRET is missing. Gateway auto-confirm will not work until the webhook signing secret is configured.",
    );
  }

  startGatewayPaymentRecovery();
  void preloadImapSessions();
}
