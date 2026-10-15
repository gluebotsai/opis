/// <reference types="node" />
import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = 'http://localhost:3000/api/v1';
const WS_URL = 'http://localhost:3000/events';
const API_KEY = 'demo-tenant-api-key-12345';

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
};

function logHeader(title: string) {
  console.log('\n======================================================');
  console.log(`🧪 ${title}`);
  console.log('======================================================');
}

function logPass(testName: string, detail?: string) {
  console.log(`  ✅ PASS: ${testName} ${detail ? `(${detail})` : ''}`);
}

function logFail(testName: string, error: string) {
  console.log(`  ❌ FAIL: ${testName} -> ${error}`);
}

async function runE2ETests() {
  console.log('🚀 Starting Telephony Platform End-to-End Automated Test Suite...\n');
  let passedCount = 0;
  let failedCount = 0;

  // --- 1. Authentication Security ---
  logHeader('1. API Authentication Security');
  try {
    await axios.get(`${API_URL}/agents`);
    logFail('Reject missing X-API-Key', 'Request succeeded unexpectedly without API key');
    failedCount++;
  } catch (err: any) {
    if (err.response?.status === 401) {
      logPass('Reject missing X-API-Key with 401 Unauthorized');
      passedCount++;
    } else {
      logFail('Reject missing X-API-Key', err.message);
      failedCount++;
    }
  }

  try {
    const res = await axios.get(`${API_URL}/agents`, { headers });
    if (res.status === 200 && Array.isArray(res.data)) {
      logPass('Authorize valid X-API-Key', `${res.data.length} agents retrieved`);
      passedCount++;
    } else {
      logFail('Authorize valid X-API-Key', `Unexpected status ${res.status}`);
      failedCount++;
    }
  } catch (err: any) {
    logFail('Authorize valid X-API-Key', err.message);
    failedCount++;
  }

  // --- 2. Agent Management & Presence ---
  logHeader('2. Agent Management & Presence Controls');
  let firstAgentId = '';
  try {
    const res = await axios.get(`${API_URL}/agents`, { headers });
    firstAgentId = res.data[0]?.id;
    logPass('List tenant agents', `Found ${res.data.length} agents (First ID: ${firstAgentId})`);
    passedCount++;

    if (firstAgentId) {
      const statusRes = await axios.put(
        `${API_URL}/agents/${firstAgentId}/status`,
        { status: 'AVAILABLE' },
        { headers }
      );
      if (statusRes.data.status === 'AVAILABLE') {
        logPass('Update Agent Status', `Status set to AVAILABLE`);
        passedCount++;
      } else {
        logFail('Update Agent Status', 'Status update failed');
        failedCount++;
      }
    }
  } catch (err: any) {
    logFail('Agent presence management', err.message);
    failedCount++;
  }

  // --- 3. Queue Management & Routing ---
  logHeader('3. ACD Queue Management');
  try {
    const res = await axios.get(`${API_URL}/queues`, { headers });
    logPass('List ACD Queues', `Found ${res.data.length} queues`);
    passedCount++;
  } catch (err: any) {
    logFail('List ACD Queues', err.message);
    failedCount++;
  }

  // --- 4. DID Phone Number Provisioning ---
  logHeader('4. DID Phone Number Management');
  try {
    const testNumber = `+18005550${Math.floor(100 + Math.random() * 900)}`;
    const res = await axios.post(
      `${API_URL}/numbers`,
      { number: testNumber, provider: 'AIRTEL', assignedTo: '1001', routeTo: 'Customer Support Queue' },
      { headers }
    );
    if (res.status === 201 && res.data.number === testNumber) {
      logPass('Provision DID Number', `Provisioned ${testNumber} assigned to Ext 1001`);
      passedCount++;
    } else {
      logFail('Provision DID Number', `Unexpected response`);
      failedCount++;
    }
  } catch (err: any) {
    logFail('Provision DID Number', err.message);
    failedCount++;
  }

  // --- 5. Call Control Life Cycle ---
  logHeader('5. Call Control Lifecycle & Actions');
  let testChannelId = '1001';
  try {
    // Originate Call
    const origRes = await axios.post(
      `${API_URL}/calls`,
      { from: '1001', to: '1002' },
      { headers }
    );
    if (origRes.status === 201 && origRes.data.status === 'INITIATED') {
      logPass('Originate Outbound Call', 'Call status: INITIATED');
      passedCount++;
    } else {
      logFail('Originate Outbound Call', 'Call origination failed');
      failedCount++;
    }

    // Hold Call
    const holdRes = await axios.post(`${API_URL}/calls/${testChannelId}/hold`, {}, { headers });
    if (holdRes.data.status === 'ON_HOLD') {
      logPass('Hold Call', 'Channel placed on hold');
      passedCount++;
    } else {
      logFail('Hold Call', 'Hold failed');
      failedCount++;
    }

    // Resume Call
    const resumeRes = await axios.post(`${API_URL}/calls/${testChannelId}/resume`, {}, { headers });
    if (resumeRes.data.status === 'RESUMED') {
      logPass('Resume Call', 'Channel resumed from hold');
      passedCount++;
    } else {
      logFail('Resume Call', 'Resume failed');
      failedCount++;
    }

    // Mute Call
    const muteRes = await axios.post(`${API_URL}/calls/${testChannelId}/mute`, {}, { headers });
    if (muteRes.data.status === 'MUTED') {
      logPass('Mute Call Audio', 'Channel audio muted');
      passedCount++;
    } else {
      logFail('Mute Call Audio', 'Mute failed');
      failedCount++;
    }

    // Unmute Call
    const unmuteRes = await axios.post(`${API_URL}/calls/${testChannelId}/unmute`, {}, { headers });
    if (unmuteRes.data.status === 'UNMUTED') {
      logPass('Unmute Call Audio', 'Channel audio unmuted');
      passedCount++;
    } else {
      logFail('Unmute Call Audio', 'Unmute failed');
      failedCount++;
    }

    // Transfer Call
    const xferRes = await axios.post(
      `${API_URL}/calls/${testChannelId}/transfer`,
      { target: '1003', type: 'BLIND' },
      { headers }
    );
    if (xferRes.data.status === 'TRANSFERRING') {
      logPass('Blind Transfer Call', 'Transferred to target 1003');
      passedCount++;
    } else {
      logFail('Blind Transfer Call', 'Transfer failed');
      failedCount++;
    }

    // Live Recording Controls
    const recStartRes = await axios.post(`${API_URL}/calls/${testChannelId}/record`, {}, { headers });
    if (recStartRes.data.status === 'RECORDING') {
      logPass('Start Live Recording', `Recording Name: ${recStartRes.data.recordingName}`);
      passedCount++;

      const recStopRes = await axios.post(
        `${API_URL}/calls/${testChannelId}/record/stop`,
        { name: recStartRes.data.recordingName },
        { headers }
      );
      if (recStopRes.data.status === 'RECORDING_STOPPED') {
        logPass('Stop Live Recording', 'Recording saved to storage');
        passedCount++;
      } else {
        logFail('Stop Live Recording', 'Stop recording failed');
        failedCount++;
      }
    } else {
      logFail('Start Live Recording', 'Start recording failed');
      failedCount++;
    }

    // Hangup Call
    const hangupRes = await axios.post(`${API_URL}/calls/${testChannelId}/hangup`, {}, { headers });
    if (hangupRes.data.status === 'HANGUP_INITIATED') {
      logPass('Hangup Call Session', 'Hangup command dispatched');
      passedCount++;
    } else {
      logFail('Hangup Call Session', 'Hangup failed');
      failedCount++;
    }
  } catch (err: any) {
    logFail('Call Control lifecycle', err.message);
    failedCount++;
  }

  // --- 6. Multi-Party Conference Bridge ---
  logHeader('6. Multi-Party Conference Bridge');
  try {
    const confRes = await axios.post(
      `${API_URL}/calls/conference`,
      { name: 'Executive Meeting', channelIds: ['1001', '1002'] },
      { headers }
    );
    if (confRes.status === 201 && confRes.data.status === 'CONFERENCE_CREATED') {
      logPass('Create Conference Bridge', 'Bridge "Executive Meeting" created');
      passedCount++;
    } else {
      logFail('Create Conference Bridge', 'Conference creation failed');
      failedCount++;
    }
  } catch (err: any) {
    logFail('Create Conference Bridge', err.message);
    failedCount++;
  }

  // --- 7. Real-Time WebSocket Connection ---
  logHeader('7. Real-Time Socket.IO Gateway');
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = io(WS_URL, { query: { tenantId: API_KEY }, timeout: 5000 });

      socket.on('connect', () => {
        logPass('WebSocket Gateway Connection', `Socket ID: ${socket.id}`);
        passedCount++;
        socket.disconnect();
        resolve();
      });

      socket.on('connect_error', (err) => {
        logFail('WebSocket Gateway Connection', err.message);
        failedCount++;
        socket.disconnect();
        resolve();
      });
    });
  } catch (err: any) {
    logFail('WebSocket Gateway Connection', err.message);
    failedCount++;
  }

  // --- Summary Report ---
  console.log('\n======================================================');
  console.log('📊 AUTOMATED E2E TEST RESULTS SUMMARY');
  console.log('======================================================');
  console.log(` Total Tests Executed: ${passedCount + failedCount}`);
  console.log(` ✅ Passed:            ${passedCount}`);
  console.log(` ❌ Failed:            ${failedCount}`);
  console.log(` 🎯 Success Rate:      ${Math.round((passedCount / (passedCount + failedCount)) * 100)}%`);
  console.log('======================================================\n');
}

runE2ETests().catch((err) => console.error('E2E Runner Error:', err));
