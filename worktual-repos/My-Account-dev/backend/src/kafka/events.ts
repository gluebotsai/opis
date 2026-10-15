export interface DomainEvent<TType extends string, TPayload> {
  id: string;
  type: TType;
  occurredAt: string;
  organizationId: string;
  payload: TPayload;
}

export interface EventPublisher {
  publish<TType extends string, TPayload>(
    event: DomainEvent<TType, TPayload>,
  ): Promise<void>;
}

export class DisabledEventPublisher implements EventPublisher {
  public async publish<TType extends string, TPayload>(
    _event: DomainEvent<TType, TPayload>,
  ): Promise<void> {
    // Kafka is an explicit boundary; configure a concrete adapter before enabling publishing.
  }
}
