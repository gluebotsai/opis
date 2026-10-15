/**
 * run: npx tsx --tsconfig tsconfig.json src/plugins/response-envelope.test.ts
 */
import Fastify from "fastify";
import { responseEnvelopePlugin } from "./response-envelope";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const app = Fastify();
await app.register(responseEnvelopePlugin);
app.get("/v1/users/by-email", async () => ({
  organization_id: "1003",
  sub: "user-1",
}));

const v1 = await app.inject({ url: "/v1/users/by-email?email=a@b.com" });
const v1Body = JSON.parse(v1.body) as Record<string, unknown>;
assert(v1Body.organization_id === "1003", "v1 contract keeps organization_id");
assert(v1Body.statusCode === undefined, "v1 must not be wrapped in API envelope");
assert(v1Body.sub === "user-1", "v1 keeps sub");

await app.close();
console.log("response-envelope tests passed");
