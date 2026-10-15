/**
 * run: npx tsx src/features/voice/sip-via-host.test.ts
 */
import assert from "node:assert/strict";
import { pickBestIpv4 } from "./sip-via-host";

const chosen = pickBestIpv4([
  { ip: "192.168.13.159", type: "host", port: 51769 },
  { ip: "49.207.10.20", type: "srflx", port: 45000 },
]);
assert.equal(chosen?.ip, "49.207.10.20");

const privateOnly = pickBestIpv4([
  { ip: "192.168.13.159", type: "host", port: 51769 },
]);
assert.equal(privateOnly?.ip, "192.168.13.159");

console.log("sip-via-host.test.ts ok");
