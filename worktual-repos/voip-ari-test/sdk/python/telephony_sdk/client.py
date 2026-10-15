import requests
from typing import Dict, Any, List, Optional

class TelephonyClient:
    def __init__(self, api_key: str, base_url: str = "http://localhost:3000/api/v1"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "Content-Type": "application/json",
            "X-API-Key": api_key
        }

    # --- Call Control ---

    def originate_call(self, from_extension: str, to_extension: str) -> Dict[str, Any]:
        url = f"{self.base_url}/calls"
        payload = {"from": from_extension, "to": to_extension}
        res = requests.post(url, json=payload, headers=self.headers)
        return res.json()

    def hangup_call(self, call_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/calls/{call_id}/hangup"
        res = requests.post(url, headers=self.headers)
        return res.json()

    def hold_call(self, call_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/calls/{call_id}/hold"
        res = requests.post(url, headers=self.headers)
        return res.json()

    def resume_call(self, call_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/calls/{call_id}/resume"
        res = requests.post(url, headers=self.headers)
        return res.json()

    def mute_call(self, call_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/calls/{call_id}/mute"
        res = requests.post(url, headers=self.headers)
        return res.json()

    def unmute_call(self, call_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/calls/{call_id}/unmute"
        res = requests.post(url, headers=self.headers)
        return res.json()

    def transfer_call(self, call_id: str, target: str, transfer_type: str = "BLIND") -> Dict[str, Any]:
        url = f"{self.base_url}/calls/{call_id}/transfer"
        payload = {"target": target, "type": transfer_type}
        res = requests.post(url, json=payload, headers=self.headers)
        return res.json()

    def start_recording(self, call_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/calls/{call_id}/record"
        res = requests.post(url, headers=self.headers)
        return res.json()

    def stop_recording(self, call_id: str, recording_name: str) -> Dict[str, Any]:
        url = f"{self.base_url}/calls/{call_id}/record/stop"
        payload = {"name": recording_name}
        res = requests.post(url, json=payload, headers=self.headers)
        return res.json()

    def create_conference(self, name: str, channel_ids: List[str]) -> Dict[str, Any]:
        url = f"{self.base_url}/calls/conference"
        payload = {"name": name, "channelIds": channel_ids}
        res = requests.post(url, json=payload, headers=self.headers)
        return res.json()

    # --- Agent Management ---

    def list_agents(self) -> Dict[str, Any]:
        url = f"{self.base_url}/agents"
        res = requests.get(url, headers=self.headers)
        return res.json()

    def create_agent(self, name: str, email: str, extension: Optional[str] = None) -> Dict[str, Any]:
        url = f"{self.base_url}/agents"
        payload = {"name": name, "email": email}
        if extension:
            payload["extension"] = extension
        res = requests.post(url, json=payload, headers=self.headers)
        return res.json()

    def update_agent_status(self, agent_id: str, status: str) -> Dict[str, Any]:
        url = f"{self.base_url}/agents/{agent_id}/status"
        payload = {"status": status}
        res = requests.put(url, json=payload, headers=self.headers)
        return res.json()

    # --- Queue Management ---

    def list_queues(self) -> Dict[str, Any]:
        url = f"{self.base_url}/queues"
        res = requests.get(url, headers=self.headers)
        return res.json()

    def create_queue(self, name: str, strategy: str = "ringall", timeout: int = 30) -> Dict[str, Any]:
        url = f"{self.base_url}/queues"
        payload = {"name": name, "strategy": strategy, "timeout": timeout}
        res = requests.post(url, json=payload, headers=self.headers)
        return res.json()

    def add_queue_member(self, queue_id: str, agent_id: str, penalty: int = 0) -> Dict[str, Any]:
        url = f"{self.base_url}/queues/{queue_id}/members"
        payload = {"agentId": agent_id, "penalty": penalty}
        res = requests.post(url, json=payload, headers=self.headers)
        return res.json()

    # --- Number Management ---

    def list_numbers(self) -> Dict[str, Any]:
        url = f"{self.base_url}/numbers"
        res = requests.get(url, headers=self.headers)
        return res.json()

    def register_number(self, number: str, provider: str = "AIRTEL", assigned_to: Optional[str] = None) -> Dict[str, Any]:
        url = f"{self.base_url}/numbers"
        payload = {"number": number, "provider": provider}
        if assigned_to:
            payload["assignedTo"] = assigned_to
        res = requests.post(url, json=payload, headers=self.headers)
        return res.json()

    # --- Webhooks ---

    def list_webhooks(self) -> Dict[str, Any]:
        url = f"{self.base_url}/webhooks"
        res = requests.get(url, headers=self.headers)
        return res.json()

    def register_webhook(self, url_target: str, secret: str, events: Optional[List[str]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}/webhooks"
        payload = {"url": url_target, "secret": secret, "events": events or ["*"]}
        res = requests.post(url, json=payload, headers=self.headers)
        return res.json()
