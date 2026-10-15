# Linphone Softphone Setup & Testing Guide

This guide provides step-by-step instructions for setting up **Linphone** (Desktop or Mobile) to register against your local Asterisk PBX and test the Telephony Platform ARI flow.

---

## 1. Quick Credentials Reference

| Extension | Password | SIP Domain / Proxy | Transport | Role |
| --- | --- | --- | --- | --- |
| **1001** | `password1001` | `localhost:5060` (or `127.0.0.1:5060`) | UDP | Linphone Agent 1 |
| **1002** | `password1002` | `localhost:5060` (or `127.0.0.1:5060`) | UDP | Linphone Agent 2 |
| **1003** | `password1003` | `localhost:5060` (or `127.0.0.1:5060`) | UDP | Supervisor |

---

## 2. Linphone Setup Instructions

1. Open **Linphone**.
2. Go to **Preferences** ➔ **Account Manager** ➔ **Add Account** ➔ **USE A SIP ACCOUNT**.
3. Fill in the following credentials:
   - **Username**: `1001` (or `1002`)
   - **SIP Domain**: `localhost` (or your IP address if testing from mobile/another device)
   - **Password**: `password1001` (or `password1002`)
   - **Transport**: `UDP`
4. Click **Confirm**.
5. Observe status change to **Connected / Registered** (Green indicator).

---

## 3. Testing Call Flows

### A. Linphone Audio Echo Test (Extension `600`)
1. Dial `600` on Linphone.
2. Speak into your microphone.
3. You will hear your voice echoed back immediately. This confirms SIP registration and RTP audio streams are working properly on your system.

### B. Linphone-to-Linphone Call with ARI Stasis Flow (`1001` ➔ `1002`)
1. Register Account `1001` on Softphone Client A (e.g., Linphone Desktop).
2. Register Account `1002` on Softphone Client B (e.g., Linphone Mobile or MicroSIP).
3. From Extension `1001`, dial `1002`.
4. **ARI Event Observation**:
   - Asterisk hands control of the channel over to Stasis application `telephony`.
   - `asterisk-adapter` receives `StasisStart` and publishes `channel.state_change` to Redis.
   - `call-service` records the session in `CallHistory` table as `RINGING` and then `ANSWERED`.
