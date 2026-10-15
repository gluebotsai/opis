# POC Contact Center & Linphone Multi-Client Testing Guide

This folder contains a standalone POC Contact Center web application built to validate multi-agent ACD queue routing, Linphone softphone integration, real-time WebSocket events, and call control APIs for your team.

---

## 🔑 Hardcoded Agent Credentials

| Agent Name | Extension | SIP Username | SIP Password | Default Presence |
|---|---|---|---|---|
| **Linphone Agent 1** | `1001` | `1001` | `password1001` | `AVAILABLE` 🟢 |
| **Linphone Agent 2** | `1002` | `1002` | `password1002` | `AVAILABLE` 🟢 |
| **Linphone Agent 3** | `1003` | `1003` | `password1003` | `BUSY` 🔴 |
| **Linphone Agent 4** | `1004` | `1004` | `password1004` | `ON_BREAK` 🟡 |
| **Linphone Agent 5** | `1005` | `1005` | `password1005` | `OFFLINE` ⚪ |

*Support Queue Extension*: **`1000`** (Routes calls to all available agents using Ring-All strategy).  
*Echo Test Extension*: **`600`** (Audio loopback test).

---

## 🚀 Step-by-Step Testing Workflow for You & Your Team

### Step 1: Start Platform Services
Ensure Docker and the backend microservices are running:
```bash
# 1. Start Asterisk, PostgreSQL, Redis containers
docker compose up -d

# 2. Run Database Seeding (populates the 5 agents & queue)
npx prisma db seed --schema=shared/prisma/schema.prisma

# 3. Start API Gateway
npm --workspace=@telephony/api run start:dev

# 4. Start Asterisk Adapter
npm --workspace=@telephony/asterisk-adapter run start:dev
```

---

### Step 2: Open the POC Contact Center Web App
Open `test_contact_center/index.html` directly in any web browser, or serve it using Node `serve`:

```bash
npx -y serve test_contact_center -p 8080
```
Then navigate to `http://localhost:8080` in your browser.

- You will see the **Live WS Status Badge** change to `WS Live Connected`.
- You will see all 5 hardcoded agents with their live presence statuses.
- You can switch between active agent consoles and toggle presence (`AVAILABLE`, `BUSY`, `ON_BREAK`, `OFFLINE`).

---

### Step 3: Register Linphone Softphone Clients

Have your team members install **Linphone** (Desktop or Mobile) and register using the hardcoded credentials:

1. Open Linphone -> **Account Assistant** -> **Use a SIP Account**.
2. Fill in the fields:
   - **SIP Identity**: `sip:1001@<YOUR_HOST_IP>` (e.g. `sip:1001@127.0.0.1`)
   - **SIP Proxy / Domain**: `<YOUR_HOST_IP>:5060` (e.g. `127.0.0.1:5060`)
   - **Username**: `1001`
   - **Password**: `password1001`
   - **Transport**: `UDP` or `TCP`
3. Click **Login**. Repeat on other devices for `1002`, `1003`, `1004`, `1005`.

---

### Step 4: Execute Test Scenarios

#### Scenario A: Audio Echo Verification
- On Linphone client `1001`, dial `600`.
- Asterisk answers, plays the demo echo message, and reflects your microphone audio back to your speakers.

#### Scenario B: Agent-to-Agent Direct Extension Call
- On Linphone client `1001`, dial `1002`.
- Linphone client `1002` will ring.
- In the POC Contact Center app (`http://localhost:8080`), you will see the **Real-Time Event Stream Log** capture `call.started`, `call.ringing`, and `call.answered`.

#### Scenario C: ACD Contact Center Support Queue Routing
- On Linphone client `1001` (or any external client), dial `1000` (Customer Support Queue).
- The platform evaluates agent presence:
  - Agent 1001 & 1002 are `AVAILABLE` -> Their softphones ring simultaneously (Ring-All).
  - Agent 1003 is `BUSY` & 1004 is `ON_BREAK` -> Skipped by ACD router.
- Switch Agent 1001's presence to `BUSY` in the POC app -> The queue dynamically updates and routes only to `1002`.

#### Scenario D: Browser Click-to-Dial & Live Call Controls
- In the POC Contact Center app, select **Linphone Agent 1** (`1001`).
- Enter Destination `1002` and click **📞 Click-to-Dial / Originate Call**.
- Linphone `1002` rings immediately.
- Use the app controls to **Hold / Resume**, **Mute**, **Transfer**, or **Record** the live call!
