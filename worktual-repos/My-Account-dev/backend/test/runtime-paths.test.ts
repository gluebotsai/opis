import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assetsRoot,
  backendRoot,
  databaseRoot,
  resolveBackendPath,
} from "../src/config/runtime-paths.js";

describe("runtime paths", () => {
  it("resolve from the backend package root", () => {
    expect(path.basename(backendRoot)).toBe("backend");
    expect(databaseRoot).toBe(path.join(backendRoot, "database"));
    expect(assetsRoot).toBe(path.join(backendRoot, "assets"));
    expect(resolveBackendPath(".env")).toBe(path.join(backendRoot, ".env"));
  });
});
