import assert from "node:assert/strict";
import test from "node:test";

import { peerConnectionIceServers } from "./sip-via-host.ts";

test("peerConnectionIceServers keeps TURN URLs and never emits stun:?transport=", () => {
  const servers = peerConnectionIceServers([
    { urls: "stun:audioturnv4.worktual.co.uk:443" },
    {
      urls: "turn:audioturnv4.worktual.co.uk:443?transport=tcp",
      username: "admin",
      credential: "system123",
    },
  ]);

  const allUrls = servers.flatMap((server) =>
    Array.isArray(server.urls) ? server.urls : [server.urls],
  );
  assert.equal(
    allUrls.some((url) => url.includes("stun:") && url.includes("?transport=")),
    false,
  );
  assert.equal(allUrls.includes("turn:audioturnv4.worktual.co.uk:443?transport=tcp"), true);
  assert.equal(allUrls.includes("stun:audioturnv4.worktual.co.uk:443"), true);
  assert.equal(
    servers.some((server) => server.username === "admin" && server.credential === "system123"),
    true,
  );
});
