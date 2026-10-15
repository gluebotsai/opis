# Telephony Platform Product Integration & API Specifications

This document serves as the primary technical documentation for product and engineering teams integrating CRM, Contact Center, AI Voice, or other applications with the Telephony Platform.

---

## 1. Overview
The Telephony Platform provides a complete multi-tenant abstraction layer over Asterisk PBX. Downstream consuming applications MUST NOT connect directly to the PBX. All interactions are handled via:
1. **REST APIs** (Call Control, Management)
2. **WebSocket Connections** (Real-time events)
3. **Webhooks** (Asynchronous notifications)
4. **Client SDKs** (JS/TS, Python)

---

## 2. Authentication
All API requests require an **API Key** or **Bearer Token** passed in the headers:
```http
Authorization: Bearer <tenant_jwt_token>
X-API-Key: <tenant_api_key>
```

---

## 3. Detailed Specifications

For complete references:
- 📖 [REST API Documentation](file:///c:/Users/Bharathi/OneDrive/Documents/projects/VOIP/docs/integration/API_Documentation.md)
- ⚡ [WebSocket Event Stream Specifications](file:///c:/Users/Bharathi/OneDrive/Documents/projects/VOIP/docs/integration/WebSocket_Events.md)
- 🔔 [Webhook Specifications & Security](file:///c:/Users/Bharathi/OneDrive/Documents/projects/VOIP/docs/integration/Webhook_Specifications.md)
- 🗄️ [Database Schema Reference](file:///c:/Users/Bharathi/OneDrive/Documents/projects/VOIP/docs/integration/Database_Schema.md)
