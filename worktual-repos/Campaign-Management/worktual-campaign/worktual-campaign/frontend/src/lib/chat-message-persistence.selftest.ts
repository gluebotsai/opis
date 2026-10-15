/**
 * Multi-image chat persistence helpers (create + edit reload merge).
 * Run: npx tsx src/lib/chat-message-persistence.selftest.ts
 */
import {
  dedupeConsecutiveUserMessages,
  mergeMessagesPreserveExact,
  type ChatMessage,
} from "@/lib/campaign-drafts";
import {
  dedupeChatMessageImages,
  resolveCreateChatBubbleImages,
} from "@/lib/chat-message-images";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const local: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Hero refs",
    createdAt: "t1",
    imageUrl: "https://cdn/a.jpg",
    imageUrls: [
      { url: "https://cdn/a.jpg" },
      { url: "https://cdn/b.jpg" },
      { url: "https://cdn/c.jpg" },
    ],
  },
];

const remote: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Hero refs",
    createdAt: "t1",
    imageUrl: "https://cdn/a.jpg",
    imageUrls: [{ url: "https://cdn/a.jpg" }],
  },
];

const deduped = dedupeConsecutiveUserMessages([...local, ...remote]);
assert(deduped.length === 1, "dedupe should collapse echo");
assert(
  (deduped[0]!.imageUrls?.length ?? 0) === 3,
  "dedupe must keep full imageUrls list",
);

const merged = mergeMessagesPreserveExact(local, remote);
assert(
  (merged[0]!.imageUrls?.length ?? 0) === 3,
  "merge must union multi-image onto server echo",
);

const lan = "http://192.168.13.91:5173/api/media/abc123";
const rebuild = "https://rebuild-campaign-api.worktual.com/api/media/abc123";
const dedupedHosts = dedupeChatMessageImages([
  { url: lan, filename: "shoe.jpeg" },
  { url: rebuild, filename: "shoe.jpeg" },
]);
assert(dedupedHosts.length === 1, "LAN + rebuild same media id must dedupe");

const bubble = resolveCreateChatBubbleImages({
  imageUrl: lan,
  imageUrls: [{ url: lan }, { url: rebuild }],
});
assert(bubble.length === 1, "create bubble must show one tile per upload");

console.log("chat-message-persistence.selftest: ok");
