import type { Logger } from "pino";

export function startKafkaConsumerStub(logger: Logger, serviceName: string): void {
  logger.info({ service: serviceName }, "kafka consumer stub registered (Phase 0)");
}
