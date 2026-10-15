import type { Logger } from "pino";

import { createLogger } from "./index.js";

export type EmailProcessLogInput = {
  organizationId: string;
  from: string;
  to: string;
  mail: string;
  subject?: string | null;
  messageId?: string | null;
};

function previewMail(mail: string, max = 160): string {
  const oneLine = mail.replace(/\s+/g, " ").trim();
  if (!oneLine) return "(empty)";
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}...`;
}

export class EmailProcessLog {
  private stepNumber = 0;
  private readonly logger: Logger;

  constructor(
    private readonly input: EmailProcessLogInput,
    logger?: Logger,
  ) {
    this.logger =
      logger?.child({ component: "email-process" }) ??
      createLogger({ service: "email-process", tenant_id: input.organizationId });
    this.logger.info(
      {
        organizationId: input.organizationId,
        from: input.from,
        to: input.to,
        subject: input.subject ?? null,
        messageId: input.messageId ?? null,
        mailPreview: previewMail(input.mail),
      },
      "email received",
    );
  }

  step(name: string, details?: Record<string, unknown>): void {
    this.stepNumber += 1;
    this.logger.info(
      {
        organizationId: this.input.organizationId,
        from: this.input.from,
        to: this.input.to,
        messageId: this.input.messageId ?? null,
        step: this.stepNumber,
        stepName: name,
        ...details,
      },
      `email step ${this.stepNumber}: ${name}`,
    );
  }

  fail(stepName: string, error: unknown, details?: Record<string, unknown>): void {
    this.stepNumber += 1;
    this.logger.error(
      {
        organizationId: this.input.organizationId,
        from: this.input.from,
        to: this.input.to,
        messageId: this.input.messageId ?? null,
        step: this.stepNumber,
        stepName,
        err: error,
        ...details,
      },
      `email step ${this.stepNumber}: ${stepName} failed`,
    );
  }

  complete(details?: Record<string, unknown>): void {
    this.logger.info(
      {
        organizationId: this.input.organizationId,
        from: this.input.from,
        to: this.input.to,
        messageId: this.input.messageId ?? null,
        totalSteps: this.stepNumber,
        ...details,
      },
      "email processing complete",
    );
  }
}

export function createEmailProcessLog(
  input: EmailProcessLogInput,
  logger?: Logger,
): EmailProcessLog {
  return new EmailProcessLog(input, logger);
}
