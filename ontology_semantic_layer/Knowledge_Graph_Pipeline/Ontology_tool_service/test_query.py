import requests
import json
import sys

def query_agent(question):
    url = "http://localhost:8000/chat"
    payload = {
        "query": question,
        "organization_id": "1000"
    }
    response = requests.post(url, json=payload)
    if response.status_code == 200:
        data = response.json()
        print(f"Q: {question}")
        print("-" * 40)
        print("Answer:", data.get('answer'))
        print("SessionID used:", data.get('sessionID'))
        print("Tool Calls:", json.dumps(data.get('tool_calls'), indent=2))
        print("=" * 80)
    else:
        print(f"Error: {response.text}")

if __name__ == "__main__":
    query_agent("what are my tickets ount today")
