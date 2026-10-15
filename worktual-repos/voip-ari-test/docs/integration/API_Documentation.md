# REST API Specifications

## Base URL
`http://localhost:3000/api/v1`

---

## Call Control Endpoints

### 1. Originate Call
`POST /calls`

Initiates an outbound call or connects two endpoints.

**Request Body:**
```json
{
  "from": "101",
  "to": "102",
  "callerId": "+1234567890"
}
```

**Response (201 Created):**
```json
{
  "callId": "call-uuid-1234",
  "status": "INITIATED",
  "from": "101",
  "to": "102",
  "createdAt": "2026-08-02T00:00:00Z"
}
```

---

### 2. Hangup Call
`POST /calls/:id/hangup`

Terminates an active call session.

**Response (200 OK):**
```json
{
  "callId": "call-uuid-1234",
  "status": "TERMINATED"
}
```

---

### 3. Hold / Resume Call
`POST /calls/:id/hold`
`POST /calls/:id/resume`

Puts an active call on hold or resumes it.

---

### 4. Transfer Call
`POST /calls/:id/transfer`

**Request Body:**
```json
{
  "target": "103",
  "type": "BLIND" // or "ATTENDED"
}
```

---

### 5. Mute / Unmute Call
`POST /calls/:id/mute`
`POST /calls/:id/unmute`
