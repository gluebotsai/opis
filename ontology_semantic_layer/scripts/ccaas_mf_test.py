import json
import os
import requests
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD_FILE = ROOT / "tests" / "fixtures" / "ccaas" / "ccaas_mf_payloads.json"
API_URL = os.environ.get("CONTEXT_LAYER_URL", "http://localhost:8765") + "/v1/semantic/query"
OUTPUT_FILE = ROOT / "tests" / "fixtures" / "ccaas" / "ccaas_test_results.json"

with open(PAYLOAD_FILE, "r", encoding="utf-8") as f:
    payloads = json.load(f)

all_results = []

for i, payload in enumerate(payloads, start=1):
    print(f"Sending payload {i}/{len(payloads)}")

    try:

        start_time = time.time()
        response = requests.post(
            API_URL,
            json=payload,
            timeout=60
        )
        print(f"Response time: {time.time() - start_time} seconds")

        try:
            result = response.json()
        except ValueError:
            result = response.text

        all_results.append({
            "test_number": i,
            "request": payload,
            "status_code": response.status_code,
            "response": result
        })

    except Exception as e:
        all_results.append({
            "test_number": i,
            "request": payload,
            "status_code": None,
            "response": None,
            "error": str(e)
        })

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(all_results, f, indent=2, ensure_ascii=False)

print(f"\nDone. All results saved to: {OUTPUT_FILE}")