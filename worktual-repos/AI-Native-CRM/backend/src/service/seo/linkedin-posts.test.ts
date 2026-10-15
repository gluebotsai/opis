/**
 * run: npx tsx src/service/seo/linkedin-posts.test.ts
 */
import {
  isLinkedInImageMime,
  linkedinImagePostBody,
  linkedinMemberScopesOk,
  linkedinRestHeaders,
  linkedinTextPostBody,
  personUrnFromSub,
  plainLinkedInCommentary,
  publishLinkedInMemberPost,
  storedLinkedInPersonUrn,
  type FetchLike,
} from "./linkedin-posts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(personUrnFromSub("AbC123") === "urn:li:person:AbC123", "wrap sub");
assert(
  personUrnFromSub("urn:li:person:AbC123") === "urn:li:person:AbC123",
  "keep person urn",
);
assert(personUrnFromSub("urn:li:organization:99") === null, "reject org urn");
assert(
  storedLinkedInPersonUrn({
    externalAccountId: "99",
    metadata: { organizationUrn: "urn:li:organization:99" },
  }) === null,
  "do not invent org author",
);
assert(
  storedLinkedInPersonUrn({
    metadata: { authorUrn: "urn:li:person:AbC123" },
  }) === "urn:li:person:AbC123",
  "stored person urn",
);

assert(linkedinMemberScopesOk(null) === null, "unknown scopes");
assert(
  linkedinMemberScopesOk("openid,profile,w_member_social") === true,
  "comma scopes",
);
assert(linkedinMemberScopesOk("openid profile") === false, "missing social");

assert(
  plainLinkedInCommentary("<p>Hello&nbsp;<b>team</b></p>") === "Hello team",
  "strip html",
);
assert(isLinkedInImageMime("image/png"), "png ok");
assert(!isLinkedInImageMime("image/webp"), "webp skip");

const headers = linkedinRestHeaders("tok");
assert(headers["Linkedin-Version"] === "202608", "default version");
assert(headers["X-Restli-Protocol-Version"] === "2.0.0", "restli");
assert(headers.Authorization.includes("tok"), "bearer present");

const textBody = linkedinTextPostBody("urn:li:person:1", "Hello");
assert(!("content" in textBody), "text post has no content");
assert(textBody.visibility === "PUBLIC", "public");
assert(textBody.lifecycleState === "PUBLISHED", "published");

const imageBody = linkedinImagePostBody(
  "urn:li:person:1",
  "Hello",
  "urn:li:image:IMG",
  "Title",
);
assert(imageBody.content.media.id === "urn:li:image:IMG", "image urn");

const calls: Array<{ url: string; method: string }> = [];
const fetchImpl: FetchLike = async (input, init) => {
  const url = String(input);
  const method = (init?.method || "GET").toUpperCase();
  calls.push({ url, method });
  if (url.includes("/v2/userinfo")) {
    return new Response(JSON.stringify({ sub: "AbC123" }), { status: 200 });
  }
  if (url.includes("action=initializeUpload")) {
    return new Response(
      JSON.stringify({
        value: {
          uploadUrl: "https://www.linkedin.com/dms-uploads/x?sig=secret",
          image: "urn:li:image:IMG1",
        },
      }),
      { status: 200 },
    );
  }
  if (url.includes("dms-uploads")) {
    return new Response(null, { status: 201 });
  }
  if (url.includes("/rest/posts")) {
    return new Response(null, {
      status: 201,
      headers: { "x-restli-id": "urn:li:share:1" },
    });
  }
  return new Response("no", { status: 500 });
};

const text = await publishLinkedInMemberPost({
  token: "tok",
  text: "A practical intro to MCP.",
  fetchImpl,
});
assert(text.error === null, `text error ${text.error}`);
assert(text.externalId === "urn:li:share:1", "share id");
assert(
  calls.some((c) => c.url.includes("/v2/userinfo")),
  "userinfo called",
);
assert(
  calls.some((c) => c.url.includes("/rest/posts") && c.method === "POST"),
  "posts called",
);

calls.length = 0;
const imaged = await publishLinkedInMemberPost({
  token: "tok",
  text: "Caption",
  storedAuthorUrn: "urn:li:person:AbC123",
  image: { bytes: Buffer.from("png"), mime: "image/png" },
  fetchImpl,
});
assert(imaged.error === null, `image error ${imaged.error}`);
assert(
  calls.some((c) => c.url.includes("initializeUpload")),
  "init upload",
);
assert(
  calls.some((c) => c.url.includes("dms-uploads") && c.method === "PUT"),
  "binary put",
);
assert(
  !calls.some((c) => c.url.includes("/v2/userinfo")),
  "skip userinfo when person urn stored",
);

const denied = await publishLinkedInMemberPost({
  token: "tok",
  text: "Hi",
  scopes: "openid profile",
  fetchImpl,
});
assert(denied.needsReauth === true, "missing scope reauth");
assert(
  (denied.error || "").includes("w_member_social"),
  "scope error mentions grant",
);

console.log("linkedin-posts.test.ts ok");
