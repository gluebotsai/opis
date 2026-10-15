# Telephony Platform V1 - Complete REST API Specification

## 1. Overview & Authentication

The Telephony Platform exposes a multi-tenant REST API gateway for CRM, Contact Center, and third-party application integration. All requests must be authenticated using a Tenant API Key passed in the request header.

### Base URL
```
http://localhost:3000/api/v1
```

### Authentication Header
| Header | Type | Description | Required |
|---|---|---|---|
| `X-API-Key` | String | Tenant API Key associated with your organization | **Yes** |
| `Content-Type` | String | `application/json` | **Yes** |

### Standard Error Response Format
```json
{
  "statusCode": 401,
  "message": "Invalid Tenant API Key",
  "error": "Unauthorized",
  "timestamp": "2026-08-02T01:22:00.000Z"
}
```

---

## 2. Call Control Service (`/calls`)

### 2.1 Originate Call
Initiates an outbound call from a SIP extension or DID number to a target endpoint.

- **Endpoint**: `POST /calls`
- **Headers**: `X-API-Key: <your-api-key>`
- **Request Body**:
```json
{
  "from": "1001",
  "to": "1002"
}
```
- **Response** `201 Created`:
```json
{
  "success": true,
  "message": "Call origination initiated",
  "status": "INITIATED"
}
```

### 2.2 Hangup Call
Terminates an active call channel.

- **Endpoint**: `POST /calls/:id/hangup`
- **URL Parameter**: `id` - Asterisk Channel ID or CallHistory UUID
- **Response** `200 OK`:
```json
{
  "success": true,
  "message": "Call hangup initiated",
  "status": "HANGUP_INITIATED"
}
```

### 2.3 Place Call on Hold
Places an active channel on hold with Music on Hold (MOH).

- **Endpoint**: `POST /calls/:id/hold`
- **Response** `200 OK`:
```json
{
  "success": true,
  "message": "Call placed on hold",
  "status": "ON_HOLD"
}
```

### 2.4 Resume Call
Resumes a call that is currently on hold.

- **Endpoint**: `POST /calls/:id/resume`
- **Response** `200 OK`:
```json
{
  "success": true,
  "message": "Call resumed",
  "status": "RESUMED"
}
```

### 2.5 Mute Call Audio
Mutes inbound audio stream on the specified channel.

- **Endpoint**: `POST /calls/:id/mute`
- **Response** `200 OK`:
```json
{
  "success": true,
  "message": "Call audio muted",
  "status": "MUTED"
}
```

### 2.6 Unmute Call Audio
Unmutes audio on the specified channel.

- **Endpoint**: `POST /calls/:id/unmute`
- **Response** `200 OK`:
```json
{
  "success": true,
  "message": "Call audio unmuted",
  "status": "UNMUTED"
}
```

### 2.7 Transfer Call (Blind / Attended)
Transfers an active call to another extension or phone number.

- **Endpoint**: `POST /calls/:id/transfer`
- **Request Body**:
```json
{
  "target": "1003",
  "type": "BLIND"
}
```
*Note: `type` can be `"BLIND"` or `"ATTENDED"` (defaults to `"BLIND"`).*

- **Response** `200 OK`:
```json
{
  "success": true,
  "message": "Call transfer initiated",
  "status": "TRANSFERRING"
}
```

### 2.8 Start Recording Live Call
Starts audio recording on an active call channel.

- **Endpoint**: `POST /calls/:id/record`
- **Response** `200 OK`:
```json
{
  "success": true,
  "message": "Recording started",
  "recordingName": "rec_call-123_1785612300",
  "status": "RECORDING"
}
```

### 2.9 Stop Recording Live Call
Stops audio recording on a call channel and saves the file.

- **Endpoint**: `POST /calls/:id/record/stop`
- **Request Body**:
```json
{
  "name": "rec_call-123_1785612300"
}
```
- **Response** `200 OK`:
```json
{
  "success": true,
  "message": "Recording stopped",
  "status": "RECORDING_STOPPED"
}
```

### 2.10 Create Conference Bridge
Creates a multi-party conference bridge and joins active channels.

- **Endpoint**: `POST /calls/conference`
- **Request Body**:
```json
{
  "name": "Executive Sync",
  "channelIds": ["1785612.1", "1785612.2"]
}
```
- **Response** `201 Created`:
```json
{
  "success": true,
  "message": "Multi-party conference created",
  "status": "CONFERENCE_CREATED"
}
```

---

## 3. Agent Management Service (`/agents`)

### 3.1 List Agents
Returns all agents registered for the tenant.

- **Endpoint**: `GET /agents`
- **Response** `200 OK`:
```json
[
  {
    "id": "ag-1",
    "tenantId": "demo-tenant-api-key-12345",
    "name": "Linphone Agent 1001",
    "email": "agent1001@example.com",
    "status": "AVAILABLE",
    "lastLoginAt": "2026-08-02T01:00:00.000Z",
    "sipExtension": {
      "id": "ext-1",
      "extension": "1001"
    }
  }
]
```

### 3.2 Create Agent
Registers a new agent and provisions an optional SIP extension.

- **Endpoint**: `POST /agents`
- **Request Body**:
```json
{
  "name": "Sarah Connor",
  "email": "sconnor@example.com",
  "extension": "1004"
}
```
- **Response** `201 Created`:
```json
{
  "id": "ag-4",
  "tenantId": "demo-tenant-api-key-12345",
  "name": "Sarah Connor",
  "email": "sconnor@example.com",
  "status": "OFFLINE"
}
```

### 3.3 Update Agent Presence Status
Updates an agent's real-time status.

- **Endpoint**: `PUT /agents/:id/status`
- **Request Body**:
```json
{
  "status": "BUSY"
}
```
*Allowed Statuses*: `OFFLINE`, `AVAILABLE`, `BUSY`, `ON_BREAK`, `WRAP_UP`.

- **Response** `200 OK`:
```json
{
  "id": "ag-1",
  "name": "Linphone Agent 1001",
  "status": "BUSY",
  "updatedAt": "2026-08-02T01:22:00.000Z"
}
```

---

## 4. Queue Service (`/queues`)

### 4.1 List Queues
Returns all ACD queues for the tenant.

- **Endpoint**: `GET /queues`
- **Response** `200 OK`:
```json
[
  {
    "id": "q-1",
    "name": "General Support Queue",
    "strategy": "ringall",
    "timeout": 30,
    "members": [
      {
        "id": "qm-1",
        "agentId": "ag-1",
        "penalty": 0,
        "agent": {
          "name": "Linphone Agent 1001",
          "status": "AVAILABLE"
        }
      }
    ]
  }
]
```

### 4.2 Create Queue
Creates a new ACD call queue.

- **Endpoint**: `POST /queues`
- **Request Body**:
```json
{
  "name": "Sales Escalations",
  "strategy": "leastrecent",
  "timeout": 45
}
```
*Strategies*: `ringall`, `roundrobin`, `leastrecent`, `random`.

- **Response** `201 Created`:
```json
{
  "id": "q-2",
  "name": "Sales Escalations",
  "strategy": "leastrecent",
  "timeout": 45
}
```

### 4.3 Add Agent to Queue
Assigns an agent to a queue.

- **Endpoint**: `POST /queues/:id/members`
- **Request Body**:
```json
{
  "agentId": "ag-2",
  "penalty": 1
}
```
- **Response** `201 Created`:
```json
{
  "id": "qm-2",
  "queueId": "q-1",
  "agentId": "ag-2",
  "penalty": 1
}
```

---

## 5. Number Management Service (`/numbers`)

### 5.1 List DID Numbers
Returns all provisioned DID phone numbers.

- **Endpoint**: `GET /numbers`
- **Response** `200 OK`:
```json
[
  {
    "id": "num-1",
    "number": "+18005550199",
    "provider": "AIRTEL",
    "assignedTo": "1001",
    "routeTo": "General Support Queue",
    "callerId": "+18005550199"
  }
]
```

### 5.2 Provision DID Number
Registers a new DID phone number with routing targets.

- **Endpoint**: `POST /numbers`
- **Request Body**:
```json
{
  "number": "+18005550200",
  "provider": "AIRTEL",
  "assignedTo": "1002",
  "routeTo": "Sales Queue"
}
```
- **Response** `201 Created`:
```json
{
  "id": "num-2",
  "number": "+18005550200",
  "provider": "AIRTEL",
  "assignedTo": "1002",
  "routeTo": "Sales Queue"
}
```

---

## 6. Webhook Management Service (`/webhooks`)

### 6.1 List Webhooks
Returns all registered webhook URLs for the tenant.

- **Endpoint**: `GET /webhooks`
- **Response** `200 OK`:
```json
[
  {
    "id": "wh-1",
    "url": "https://crm.example.com/api/telephony-events",
    "events": ["call.started", "call.ended", "recording.ready"],
    "isActive": true
  }
]
```

### 6.2 Register Webhook
Registers a callback URL for event delivery.

- **Endpoint**: `POST /webhooks`
- **Request Body**:
```json
{
  "url": "https://crm.example.com/api/telephony-events",
  "secret": "wh_sec_987654321",
  "events": ["*"]
}
```
- **Response** `201 Created`:
```json
{
  "id": "wh-2",
  "url": "https://crm.example.com/api/telephony-events",
  "events": ["*"],
  "isActive": true
}
```
