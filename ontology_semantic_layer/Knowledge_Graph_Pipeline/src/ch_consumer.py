import logging
from confluent_kafka import Consumer as KafkaConsumer
from src.ch_adapter import adapt_clickhouse_payload

log = logging.getLogger(__name__)

class ClickHouseConsumer:
    def __init__(self, loader, registry, router, writer, provisioner, quarantine, metrics, pg_factory):
        self.loader = loader
        self.registry = registry
        self.router = router
        self.writer = writer
        self.provisioner = provisioner
        self.quarantine = quarantine
        self.metrics = metrics
        self.pg_factory = pg_factory
        self.kafka_config = loader.section("kafka")

    def bootstrap(self):
        # We assume PostgreSQL registry loading is already handled by main.py _build_runtime
        log.info("ClickHouse consumer bootstrapped")

    def run(self):
        # Dedicated consumer group for ClickHouse pipeline
        conf = {
            'bootstrap.servers': self.kafka_config["brokers"],
            'group.id': self.kafka_config.get("group_id", "neo4j-cdc-group") + "-clickhouse",
            'auto.offset.reset': 'earliest',
            'enable.auto.commit': False
        }
        
        consumer = KafkaConsumer(conf)
        
        # Subscribe to all MV topics matching our tables
        prefix = "cdc_mv_"
        tables = [t for t in self.loader.core_tables if t.startswith("web_tracking.")]
        # We don't subscribe to specific tables yet, just a pattern or a list
        # For this skeleton, we just listen to a specific topic pattern
        topics = [f"cdcch.webtracking.{t.split('.')[-1]}" for t in tables]
        
        # If no explicit tables are defined for clickhouse, just listen to a wildcard pattern
        if not topics:
            topics = ["^cdcch\\..*"]
            
        consumer.subscribe(topics)
        log.info(f"ClickHouse consumer subscribed to: {topics}")
        
        try:
            while True:
                msg = consumer.poll(1.0)
                
                if msg is None:
                    continue
                if msg.error():
                    log.error(f"Kafka error: {msg.error()}")
                    continue
                    
                topic = msg.topic()
                
                # Extract table name from topic (e.g., cdcch.webtracking.dim_sessions -> dim_sessions)
                parts = topic.split('.')
                table_name = parts[-1] if len(parts) > 1 else topic
                
                # Adapt payload
                adapted_payload = adapt_clickhouse_payload(msg.value(), table_name)
                
                if not adapted_payload:
                    log.warning(f"Unparseable ClickHouse payload on {topic}")
                    self.quarantine.add(topic, msg.value(), "unparseable JSON")
                    consumer.commit(asynchronous=False)
                    continue

                # The router expects op, after, source
                decision = self.router.route(topic, adapted_payload)
                
                from src.router import RoutedEvent
                if isinstance(decision, RoutedEvent):
                    self.writer.add(decision)
                    # We flush per message for safety in the skeleton, batching can be added later
                    self.writer.flush_all()
                    
                consumer.commit(asynchronous=False)
                
        except KeyboardInterrupt:
            log.info("ClickHouse consumer interrupted")
        finally:
            consumer.close()
            log.info("ClickHouse consumer closed")
