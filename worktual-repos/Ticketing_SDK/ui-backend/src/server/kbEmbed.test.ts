import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  kbEmbedBaseUrl,
  normalizeKbStatus,
  scheduleKbEmbedDelete,
  scorePublishedKbFallback,
  searchKbViaEmbed,
  syncKbEmbedAfterWrite,
  webchatRelatedArticlePayload,
} from "./kbEmbed.js";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.KB_EMBED_URL;
const originalToken = process.env.KB_EMBED_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.KB_EMBED_URL;
  else process.env.KB_EMBED_URL = originalUrl;
  if (originalToken === undefined) delete process.env.KB_EMBED_TOKEN;
  else process.env.KB_EMBED_TOKEN = originalToken;
});

describe("kbEmbed hooks", () => {
  it("normalizeKbStatus maps published/draft only", () => {
    assert.equal(normalizeKbStatus("published"), "Published");
    assert.equal(normalizeKbStatus("Draft"), "Draft");
    assert.equal(normalizeKbStatus(""), "");
  });

  it("kbEmbedBaseUrl trims trailing slash", () => {
    process.env.KB_EMBED_URL = "http://embed.test:8040/";
    assert.equal(kbEmbedBaseUrl(), "http://embed.test:8040");
  });

  it("publish calls ingest-article with KB id", async () => {
    process.env.KB_EMBED_URL = "http://embed.test:8040";
    process.env.KB_EMBED_TOKEN = "secret";
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const parsed =
        typeof url === "string" ? url : url instanceof URL ? url.href : String(url);
      calls.push({
        url: parsed,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    }) as typeof fetch;

    await syncKbEmbedAfterWrite({
      organizationId: "1000",
      articleId: "KB-2201",
      title: "Refund taking longer than expected",
      content: "1. Check status\n2. Wait",
      previousStatus: "Draft",
      nextStatus: "Published",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://embed.test:8040/ingest-article");
    assert.deepEqual(calls[0].body, {
      organization_id: "1000",
      article_id: "KB-2201",
      title: "Refund taking longer than expected",
      content: "1. Check status\n2. Wait",
    });
  });

  it("draft create does not call embed", async () => {
    process.env.KB_EMBED_URL = "http://embed.test:8040";
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await syncKbEmbedAfterWrite({
      organizationId: "1000",
      articleId: "KB-1",
      title: "Draft",
      content: "Body text here",
      previousStatus: null,
      nextStatus: "Draft",
    });
    assert.equal(called, 0);
  });

  it("unpublish deletes the index document", async () => {
    process.env.KB_EMBED_URL = "http://embed.test:8040";
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(typeof url === "string" ? url : url instanceof URL ? url.href : String(url));
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    }) as typeof fetch;

    await syncKbEmbedAfterWrite({
      organizationId: "1000",
      articleId: "KB-2201",
      title: "Refund",
      content: "Body",
      previousStatus: "Published",
      nextStatus: "Draft",
    });
    assert.deepEqual(urls, ["http://embed.test:8040/delete-document"]);
  });

  it("scheduleKbEmbedDelete calls delete-document", async () => {
    process.env.KB_EMBED_URL = "http://embed.test:8040";
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(typeof url === "string" ? url : url instanceof URL ? url.href : String(url));
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    }) as typeof fetch;

    scheduleKbEmbedDelete({ organizationId: "1000", articleId: "KB-2201" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(urls, ["http://embed.test:8040/delete-document"]);
  });

  it("embed failure does not throw", async () => {
    process.env.KB_EMBED_URL = "http://embed.test:8040";
    globalThis.fetch = (async () => {
      throw new Error("down");
    }) as typeof fetch;

    await syncKbEmbedAfterWrite({
      organizationId: "1000",
      articleId: "KB-2201",
      title: "Refund",
      content: "Body",
      nextStatus: "Published",
    });
  });

  it("skips when KB_EMBED_URL is unset", async () => {
    delete process.env.KB_EMBED_URL;
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await syncKbEmbedAfterWrite({
      organizationId: "1000",
      articleId: "KB-1",
      title: "T",
      content: "Body",
      nextStatus: "Published",
    });
    assert.equal(called, 0);
  });

  it("searchKbViaEmbed returns the single compact hit", async () => {
    process.env.KB_EMBED_URL = "http://embed.test:8040";
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({
          hit: {
            article_id: "KB-vpn",
            title: "VPN",
            symptoms: ["offline"],
            steps: ["Reconnect"],
            text: "VPN. offline. Reconnect",
            score: 0.91,
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const out = await searchKbViaEmbed("1000", "vpn offline");
    assert.equal(out.hit?.articleId, "KB-vpn");
    assert.deepEqual(out.hit?.steps, ["Reconnect"]);
    assert.equal(out.reason, undefined);
  });

  it("searchKbViaEmbed maps Meili 503 to meili_unavailable", async () => {
    process.env.KB_EMBED_URL = "http://embed.test:8040";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: "Cannot reach Meilisearch" }), {
        status: 503,
      })) as typeof fetch;
    const out = await searchKbViaEmbed("1000", "vpn");
    assert.equal(out.hit, null);
    assert.equal(out.reason, "meili_unavailable");
  });

  it("searchKbViaEmbed is unavailable when URL is unset", async () => {
    delete process.env.KB_EMBED_URL;
    const out = await searchKbViaEmbed("1000", "vpn");
    assert.equal(out.hit, null);
    assert.equal(out.reason, "meili_unavailable");
  });

  it("fallback scores one published title+excerpt only", () => {
    const hit = scorePublishedKbFallback("vpn tunnel client", [
      { id: "a2", title: "Office plants", excerpt: "watering schedule" },
      { id: "a1", title: "Reset VPN client", excerpt: "vpn tunnel steps" },
    ]);
    assert.equal(hit?.articleId, "a1");
    assert.ok((hit?.text || "").length <= 400);
  });

  it("webchatRelatedArticlePayload flags related only when a hit exists", () => {
    assert.deepEqual(webchatRelatedArticlePayload(null), {
      related: false,
      article: null,
    });
    const mapped = webchatRelatedArticlePayload({
      articleId: "KB-vpn",
      title: "Reset VPN",
      symptoms: ["offline"],
      steps: ["Reconnect"],
      text: "Reconnect the client",
      score: 0.8,
    });
    assert.equal(mapped.related, true);
    assert.equal(mapped.article?.articleId, "KB-vpn");
  });
});
