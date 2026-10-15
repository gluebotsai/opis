import axios from 'axios';
import { TelephonyClient } from '../../apps/sdk/src';

describe('Telephony Platform End-to-End Test Suite', () => {
  const API_URL = 'http://localhost:3000/api/v1';
  const API_KEY = 'demo-tenant-api-key-12345';
  let client: TelephonyClient;

  beforeAll(() => {
    client = new TelephonyClient({
      apiKey: API_KEY,
      baseUrl: API_URL,
    });
  });

  describe('1. Authentication Security', () => {
    it('should reject requests missing X-API-Key with 401 Unauthorized', async () => {
      try {
        await axios.get(`${API_URL}/agents`);
      } catch (err: any) {
        expect(err.response.status).toBe(401);
      }
    });

    it('should allow requests with valid X-API-Key', async () => {
      const res = await axios.get(`${API_URL}/agents`, {
        headers: { 'X-API-Key': API_KEY },
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
    });
  });

  describe('2. Call Control Life Cycle via SDK', () => {
    let activeCallId: string;

    it('should originate an outbound call between Linphone 1001 and 1002', async () => {
      const call = await client.calls.originate({
        from: '1001',
        to: '1002',
      });

      expect(call.success).toBe(true);
      expect(call.callId).toBeDefined();
      expect(call.status).toBe('INITIATED');
      activeCallId = call.callId;
    });

    it('should place active call on hold', async () => {
      const res = await client.calls.hold(activeCallId);
      expect(res.success).toBe(true);
      expect(res.status).toBe('ON_HOLD');
    });

    it('should resume active call from hold', async () => {
      const res = await client.calls.resume(activeCallId);
      expect(res.success).toBe(true);
      expect(res.status).toBe('RESUMED');
    });

    it('should mute call audio stream', async () => {
      const res = await client.calls.mute(activeCallId);
      expect(res.success).toBe(true);
      expect(res.status).toBe('MUTED');
    });

    it('should unmute call audio stream', async () => {
      const res = await client.calls.unmute(activeCallId);
      expect(res.success).toBe(true);
      expect(res.status).toBe('UNMUTED');
    });

    it('should terminate active call session', async () => {
      const res = await client.calls.hangup(activeCallId);
      expect(res.success).toBe(true);
      expect(res.status).toBe('HANGUP_INITIATED');
    });
  });

  describe('3. Agent & Queue Operations', () => {
    it('should list agents and update status to AVAILABLE', async () => {
      const agents = await client.agents.list();
      expect(agents.length).toBeGreaterThan(0);

      const agentId = agents[0].id;
      const updated = await client.agents.updateStatus(agentId, 'AVAILABLE');
      expect(updated.status).toBe('AVAILABLE');
    });
  });
});
