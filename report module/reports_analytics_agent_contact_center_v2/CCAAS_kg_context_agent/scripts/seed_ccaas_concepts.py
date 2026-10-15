import json
import os
import meilisearch

MEILI_URL = os.getenv("MEILISEARCH_URL", "http://82.113.92.44:7700")
MEILI_KEY = os.getenv("MEILISEARCH_API_KEY", "Worktual-123")
MEILI_INDEX = os.getenv("MEILISEARCH_INDEX", "kg_ccaas")

concept_cards = [
    {
        "id": "concept_ccaas_channel_frequency",
        "type": "business_concept",
        "name": "Channel Volume and Frequency",
        "aliases": ["channel high frequency", "most popular channel", "volume by channel", "interactions per channel", "highest frequency"],
        "description": "Analyzes the frequency of conversations or interactions segmented by channel (e.g., voice, email, chat).",
        "base_entities": ["Conversation"],
        "business_rules": [
            "Use c.channel to group conversations by channel type.",
            "Count the number of conversations per channel using count(c).",
            "Filter by date using c.created_at >= datetime($period_start) AND c.created_at <= datetime($period_end)."
        ],
        "cypher_template": "MATCH (c:Conversation) WHERE c.created_at >= datetime($period_start) AND c.created_at <= datetime($period_end) RETURN c.channel AS channel, count(c) AS volume ORDER BY volume DESC",
        "diagnostic_template": "This counts the absolute volume of conversations originating from each channel to determine frequency."
    },
    {
        "id": "concept_ccaas_aht",
        "type": "business_concept",
        "name": "Average Handle Time (AHT)",
        "aliases": ["AHT", "handle time", "average duration", "how long do conversations take"],
        "description": "The average time it takes for an agent to resolve or complete an interaction. MUST be segmented by channel.",
        "base_entities": ["Conversation"],
        "business_rules": [
            "AHT is calculated as duration.between(c.created_at, c.ended_at).seconds.",
            "Only consider conversations where c.ended_at IS NOT NULL.",
            "Always segment by c.channel because asynchronous channels (email) take much longer than synchronous (voice)."
        ],
        "cypher_template": "MATCH (c:Conversation) WHERE c.created_at >= datetime($period_start) AND c.created_at <= datetime($period_end) AND c.ended_at IS NOT NULL RETURN c.channel AS channel, avg(duration.between(c.created_at, c.ended_at).seconds) AS aht_seconds",
        "diagnostic_template": "Calculates the average handle time in seconds, separated by channel."
    },
    {
        "id": "concept_ccaas_missed_calls",
        "type": "business_concept",
        "name": "Missed Calls / Abandoned Interactions",
        "aliases": ["missed calls", "abandoned calls", "dropped interactions", "unanswered"],
        "description": "Conversations that were dropped, abandoned by the customer, or missed by an agent.",
        "base_entities": ["MissedContact", "Conversation"],
        "business_rules": [
            "Missed contacts can be found by querying (m:MissedContact).",
            "Group missed contacts by m.reason (e.g., no_agent_available, offer_timeout).",
            "Filter using m.created_at >= datetime($period_start)."
        ],
        "cypher_template": "MATCH (m:MissedContact) WHERE m.created_at >= datetime($period_start) AND m.created_at <= datetime($period_end) RETURN m.reason AS reason, count(m) AS missed_count ORDER BY missed_count DESC",
        "diagnostic_template": "Identifies the volume and reasons for missed or abandoned customer interactions."
    },
    {
        "id": "concept_ccaas_queue_volume",
        "type": "business_concept",
        "name": "Queue Volume",
        "aliases": ["busy queues", "queue traffic", "routing volume"],
        "description": "The number of conversations routed to specific contact center queues.",
        "base_entities": ["Conversation", "ContactCentreQueue"],
        "business_rules": [
            "Match using (c:Conversation)-[:ROUTED_TO]->(q:ContactCentreQueue).",
            "Return q.name and count(c)."
        ],
        "cypher_template": "MATCH (c:Conversation)-[:ROUTED_TO]->(q:ContactCentreQueue) WHERE c.created_at >= datetime($period_start) AND c.created_at <= datetime($period_end) RETURN q.name AS queue, count(c) AS routed_volume ORDER BY routed_volume DESC",
        "diagnostic_template": "Analyzes the routing volume per contact center queue."
    }
]

def run():
    client = meilisearch.Client(MEILI_URL, MEILI_KEY)
    index = client.index(MEILI_INDEX)
    task = index.add_documents(concept_cards)
    print(f"Added {len(concept_cards)} concept cards to {MEILI_INDEX} (Task ID: {task.task_uid})")

if __name__ == "__main__":
    run()
