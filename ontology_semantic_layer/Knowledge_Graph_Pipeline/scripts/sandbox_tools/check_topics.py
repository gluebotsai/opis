from confluent_kafka.admin import AdminClient
a = AdminClient({'bootstrap.servers': '10.180.0.126:9092'})
md = a.list_topics(timeout=10)
for t in md.topics:
    if 'cdp.customer_events' in t:
        print(f"FOUND: {t}")
print("Done")
