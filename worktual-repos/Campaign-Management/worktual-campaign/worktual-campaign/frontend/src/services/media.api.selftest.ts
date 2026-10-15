/**
 * Run: npx tsx --tsconfig tsconfig.json src/services/media.api.selftest.ts
 */
import { absolutizeMediaUrl } from "./media.api.ts";

const lan = "http://192.168.13.91:3001/api/media/6b3e577d-2c06-4080-ba81-0a68d988e2b8";
const kept = absolutizeMediaUrl(lan, { localDev: true });
if (kept !== lan) {
  throw new Error(`dev LAN media must stay on :3001, got ${kept}`);
}

const rel = "/api/media/6b3e577d-2c06-4080-ba81-0a68d988e2b8";
const keptRel = absolutizeMediaUrl(rel, { localDev: true });
if (keptRel !== rel) {
  throw new Error(`dev relative media must stay same-origin, got ${keptRel}`);
}

const stamped = absolutizeMediaUrl(lan, { localDev: false });
if (!stamped.startsWith("https://rebuild-campaign-api.worktual.com/api/media/")) {
  throw new Error(`prod must stamp rebuild, got ${stamped}`);
}

console.log("media.api.selftest ok");
