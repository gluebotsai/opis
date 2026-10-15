/**
 * Run: npx tsx --tsconfig tsconfig.json src/lib/campaign-template-timeline.selftest.ts
 */
import type { CampaignChatDraft, ChatMessage } from "./campaign-drafts";
import {
  draftToSessionPayload,
  mergeMessagesServerWinsPendingLocal,
  sessionPayloadToDraft,
} from "./campaign-drafts";
import type { TemplateCard } from "../services/agents.socket";
import {
  bindGeneratePinToBatch,
  rememberGenerateUserPin,
  resetGeneratePins,
  takePinForTemplatesReady,
} from "./campaign-generate-pin";
import {
  appendCreatedChannelTemplates,
  appendMissingTimelineCardsFromSession,
  isLibraryTemplateRef,
  momentsAfterUserTurn,
  normalizeChatTimeline,
  pinFromDraft,
  pinForNewGeneration,
  pinFromEventOrDraft,
  reconcileLibraryTimelineIds,
  repairTimelinePlacement,
  resolveEditorTemplateCard,
  selectFreshCardsForAppend,
  templatesReadyDedupeKey,
} from "./campaign-template-timeline";
import {
  blocksAfterUserTurn,
  blocksForChatMessage,
  inFlightProgressForTurn,
} from "./campaign-generation-blocks";

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}

function user(id: string, text: string): ChatMessage {
  return { id, role: "user", text, createdAt: "2026-09-24T00:00:00Z" };
}

function assistant(id: string): ChatMessage {
  return {
    id,
    role: "assistant",
    text: "Ready",
    createdAt: "2026-09-24T00:00:01Z",
  };
}

function card(
  templateId: string,
  channel: string,
  batch: string,
  createdAt: string,
): TemplateCard {
  return {
    template_id: templateId,
    channel,
    generation_batch_id: batch,
    created_at: createdAt,
    fields: { subject: templateId },
  };
}

function draftOf(
  messages: ChatMessage[],
  timeline: CampaignChatDraft["timelineTemplates"] = [],
): CampaignChatDraft {
  return {
    id: "s1",
    name: "Test",
    goal: "Test",
    channels: ["email", "app"],
    audience: "",
    schedule: "",
    flowSteps: [],
    status: "drafting",
    messages,
    timelineTemplates: timeline,
    dirty: true,
    createdAt: "2026-09-24T00:00:00Z",
    updatedAt: "2026-09-24T00:00:00Z",
    launchedAt: null,
  };
}

function channelsAt(
  draft: CampaignChatDraft,
  userMsg: ChatMessage,
): string[] {
  const moments = normalizeChatTimeline(
    draft.timelineTemplates,
    draft.messages,
  );
  return momentsAfterUserTurn(moments, userMsg, draft.messages).flatMap((m) =>
    (m.cards || []).map((c) => `${c.channel}:${c.template_id}`),
  );
}

const u1 = user("u1", "Create email and app");
const a1 = assistant("a1");
const u2 = user("u2", "Regenerate");
const a2 = assistant("a2");
const u3 = user("u3", "Regenerate again");

let d = draftOf([u1]);
const pin1 = pinFromDraft(d);
assert(pin1.pinUserOrdinal === 1, "first generate pin ordinal is 1");
d = appendCreatedChannelTemplates(
  d,
  [
    card("e1", "email", "b1", "2026-09-24T01:00:00Z"),
    card("p1", "app", "b1", "2026-09-24T01:00:00Z"),
  ],
  pin1,
  "b1",
);
assert(channelsAt(d, u1).sort().join(",") === "app:p1,email:e1", "create shows email+app under ask 1");
assert(
  (d.timelineTemplates || []).length === 1,
  "create is one stack, not two moments",
);

d = { ...d, messages: [u1, a1, u2] };
const pin2 = pinFromDraft(d);
assert(pin2.pinUserOrdinal === 2, "regen pin ordinal is 2");
d = appendCreatedChannelTemplates(
  d,
  [
    card("e2", "email", "b2", "2026-09-24T02:00:00Z"),
    card("p2", "app", "b2", "2026-09-24T02:00:00Z"),
  ],
  pin2,
  "b2",
);
assert(channelsAt(d, u1).sort().join(",") === "app:p1,email:e1", "card 1 stays under create");
assert(channelsAt(d, u2).sort().join(",") === "app:p2,email:e2", "card 2 under regenerate");
assert((d.timelineTemplates || []).length === 2, "regen appends a second stack");

d = { ...d, messages: [u1, a1, u2, a2, u3] };
const pin3 = pinFromDraft(d);
assert(pin3.pinUserOrdinal === 3, "second regen pin ordinal is 3");
d = appendCreatedChannelTemplates(
  d,
  [
    card("e3", "email", "b3", "2026-09-24T03:00:00Z"),
    card("p3", "app", "b3", "2026-09-24T03:00:00Z"),
  ],
  pin3,
  "b3",
);
assert(channelsAt(d, u1).join(",").includes("e1"), "card 1 never moves");
assert(channelsAt(d, u2).join(",").includes("e2"), "card 2 never moves");
assert(channelsAt(d, u3).sort().join(",") === "app:p3,email:e3", "card 3 under third ask");

const remapped = [
  user("nu1", "Create email and app"),
  assistant("na1"),
  user("nu2", "Regenerate"),
  assistant("na2"),
  user("nu3", "Regenerate again"),
];
const repaired = repairTimelinePlacement(d.timelineTemplates || [], remapped);
const remappedDraft = { ...d, messages: remapped, timelineTemplates: repaired };
assert(
  channelsAt(remappedDraft, remapped[0]!).join(",").includes("e1"),
  "View remap keeps card 1 on first user",
);
assert(
  channelsAt(remappedDraft, remapped[2]!).join(",").includes("e2"),
  "View remap keeps card 2 on second user",
);
assert(
  channelsAt(remappedDraft, remapped[4]!).join(",").includes("e3"),
  "View remap keeps card 3 on third user",
);

const history = [
  card("e1", "email", "b1", "2026-09-24T01:00:00Z"),
  card("p1", "app", "b1", "2026-09-24T01:00:00Z"),
  card("e2", "email", "b2", "2026-09-24T02:00:00Z"),
  card("p2", "app", "b2", "2026-09-24T02:00:00Z"),
  card("e3", "email", "b3", "2026-09-24T03:00:00Z"),
  card("p3", "app", "b3", "2026-09-24T03:00:00Z"),
  card("e4", "email", "b4", "2026-09-24T04:00:00Z"),
  card("p4", "app", "b4", "2026-09-24T04:00:00Z"),
  card("e5", "email", "b5", "2026-09-24T05:00:00Z"),
  card("p5", "app", "b5", "2026-09-24T05:00:00Z"),
  card("e6", "email", "b6", "2026-09-24T06:00:00Z"),
  card("p6", "app", "b6", "2026-09-24T06:00:00Z"),
];
const seeded = {
  ...remappedDraft,
  messages: remapped,
};
const dumped = appendMissingTimelineCardsFromSession(seeded, history);
const underFirst = channelsAt(dumped, remapped[0]!);
assert(
  underFirst.filter((row) => row.startsWith("email:")).length === 1,
  "session dump must not put 6 emails under the first ask",
);
assert(
  underFirst.filter((row) => row.startsWith("app:")).length === 1,
  "session dump must not put 6 app cards under the first ask",
);

const emptyRecover = appendMissingTimelineCardsFromSession(
  draftOf([u1]),
  history,
);
assert(
  channelsAt(emptyRecover, u1).length === 0,
  "empty timeline without pins must not dump history onto the last user",
);

const recoveredPinned = appendMissingTimelineCardsFromSession(
  {
    ...draftOf([u1]),
    generationPins: { b6: { pinUserMessageId: "u1", pinUserOrdinal: 1 } },
  },
  history,
);
assert(
  channelsAt(recoveredPinned, u1).sort().join(",") === "app:p6,email:e6",
  "empty timeline recovers a batch only when generationPins names it",
);

d = appendCreatedChannelTemplates(
  draftOf([u1]),
  [card("e1", "email", "b1", "2026-09-24T01:00:00Z")],
  pinFromDraft(draftOf([u1])),
  "b1",
);
d = appendCreatedChannelTemplates(
  d,
  [card("p1", "app", "b1", "2026-09-24T01:00:01Z")],
  pinFromDraft(d),
  "b1",
);
assert((d.timelineTemplates || []).length === 1, "late app card merges into same batch stack");
assert(channelsAt(d, u1).sort().join(",") === "app:p1,email:e1", "same batch keeps email+app together");

assert(
  templatesReadyDedupeKey({ generation_batch_id: "b2" }) === "batch:b2",
  "ready events dedupe by batch id",
);
assert(
  templatesReadyDedupeKey({ pin_user_message_id: "u2", template_count: 1 }) !==
    templatesReadyDedupeKey({ pin_user_message_id: "u3", template_count: 1 }),
  "two 1-card generates must not share misc dedupe key",
);

const firstHtml = (d.timelineTemplates || [])[0]?.cards.find((c) => c.channel === "email")
  ?.fields as { subject?: string } | undefined;
d = appendCreatedChannelTemplates(
  { ...d, messages: [u1, a1, u2] },
  [card("e-img", "email", "b-img", "2026-09-24T07:00:00Z")],
  pinFromDraft({ ...d, messages: [u1, a1, u2] }),
  "b-img",
);
const stillFirst = (d.timelineTemplates || [])[0]?.cards.find((c) => c.channel === "email");
assert(stillFirst?.template_id === "e1", "later generate must not replace card 1 template_id");
assert(
  (stillFirst?.fields as { subject?: string } | undefined)?.subject === firstHtml?.subject,
  "later generate must not rewrite card 1 snapshot fields",
);

const live = draftOf([u1, a1, u2, a2, u3]);
let pinned = appendCreatedChannelTemplates(
  live,
  [card("e1", "email", "b1", "2026-09-24T01:00:00Z")],
  pinFromDraft(draftOf([u1])),
  "b1",
);
pinned = appendCreatedChannelTemplates(
  { ...pinned, messages: [u1, a1, u2] },
  [card("e2", "email", "b2", "2026-09-24T02:00:00Z")],
  pinFromDraft({ ...pinned, messages: [u1, a1, u2] }),
  "b2",
);
pinned = appendCreatedChannelTemplates(
  { ...pinned, messages: [u1, a1, u2, a2, u3] },
  [card("e3", "email", "b3", "2026-09-24T03:00:00Z")],
  pinFromDraft({ ...pinned, messages: [u1, a1, u2, a2, u3] }),
  "b3",
);
const ordinalsBefore = (pinned.timelineTemplates || []).map((m) => m.pinUserOrdinal);
assert(ordinalsBefore.join(",") === "1,2,3", "generate pins freeze as 1,2,3");

const refreshedMessages = [
  user("fresh-u1", "Create email and app"),
  assistant("fresh-a1"),
  user("fresh-u2", "Regenerate"),
  assistant("fresh-a2"),
  user("fresh-u3", "Regenerate again"),
];
const afterRefresh = {
  ...pinned,
  messages: refreshedMessages,
  timelineTemplates: normalizeChatTimeline(
    pinned.timelineTemplates,
    refreshedMessages,
  ),
};
assert(
  channelsAt(afterRefresh, refreshedMessages[0]!).join(",").includes("e1"),
  "refresh keeps card 1 under first ask",
);
assert(
  channelsAt(afterRefresh, refreshedMessages[2]!).join(",").includes("e2"),
  "refresh keeps card 2 under second ask",
);
assert(
  channelsAt(afterRefresh, refreshedMessages[4]!).join(",").includes("e3"),
  "refresh keeps card 3 under third ask",
);
assert(
  (afterRefresh.timelineTemplates || []).map((m) => m.pinUserOrdinal).join(",") ===
    "1,2,3",
  "refresh must not rewrite frozen pin ordinals",
);
assert(
  !channelsAt(afterRefresh, refreshedMessages[0]!).includes("e2"),
  "refresh must not stack card 2 under the first generate",
);

const repairedOrdinals = repairTimelinePlacement(
  pinned.timelineTemplates || [],
  refreshedMessages,
).map((m) => Number(m.pinUserOrdinal || 0));
assert(repairedOrdinals.join(",") === "1,2,3", "repair never changes stored ordinals");

assert(
  pinFromDraft(draftOf([u1, a1, u2])).pinUserOrdinal === 2,
  "pinFromEvent missing ordinal still uses last user",
);
const fromEvent = pinForNewGeneration(
  draftOf([u1, a1, u2, a2, u3]),
  { pinUserMessageId: "u2", pinUserOrdinal: 2 },
  "b2",
);
assert(fromEvent.pinUserOrdinal === 2, "remembered generate pin stays on that user");
assert(fromEvent.pinUserMessageId === "u2", "remembered generate pin maps to that user");

let owned = appendCreatedChannelTemplates(
  draftOf([u1]),
  [card("e1", "email", "b1", "2026-09-24T01:00:00Z")],
  pinFromDraft(draftOf([u1])),
  "b1",
);
owned = { ...owned, messages: [u1, a1, u2] };
const stalePin = pinFromEventOrDraft(owned, {
  pin_user_message_id: "u1",
  pin_user_ordinal: 1,
  generation_batch_id: "b2",
});
assert(
  stalePin.pinUserMessageId === "u2",
  "stale pin from generate 1 cannot steal a new batch",
);
owned = appendCreatedChannelTemplates(
  owned,
  [card("e2", "email", "b2", "2026-09-24T02:00:00Z")],
  stalePin,
  "b2",
);
assert(channelsAt(owned, u1).join(",").includes("e1"), "batch A stays under turn 1");
assert(!channelsAt(owned, u1).includes("e2"), "batch B must not land under turn 1");
assert(channelsAt(owned, u2).join(",").includes("e2"), "batch B stays under turn 2");

const idPicked = selectFreshCardsForAppend(
  owned.timelineTemplates,
  [
    card("e1", "email", "111", "2026-09-24T01:00:00Z"),
    card("e2", "email", "222", "2026-09-24T02:00:00Z"),
    card("e3", "email", "333", "2026-09-24T03:00:00Z"),
  ],
  "uuid-does-not-match-numeric-batch",
  ["e3"],
);
assert(
  idPicked.length === 1 && idPicked[0]?.template_id === "e3",
  "templates_ready template_ids win over a mismatched batch id",
);

assert(
  !isLibraryTemplateRef("705452306273293937"),
  "numeric campaign template ids are not library catalog refs",
);
assert(
  isLibraryTemplateRef("99", ["99"]),
  "explicit usedLibraryTemplateIds still remap",
);

const twoEmails = [
  card("705452306273293937", "email", "b1", "2026-09-24T01:00:00Z"),
  card("297643835470328932", "email", "b2", "2026-09-24T02:00:00Z"),
];
const editorA = resolveEditorTemplateCard(
  { ...twoEmails[0]!, fields: { compiled_html: "<p>A</p>" } },
  twoEmails,
);
assert(
  editorA.template_id === "705452306273293937",
  "View/edit follows template A id, not the latest email",
);
assert(
  resolveEditorTemplateCard(twoEmails[1]!, twoEmails).template_id ===
    "297643835470328932",
  "View/edit follows template B id",
);

const remappedLib = reconcileLibraryTimelineIds(
  {
    ...owned,
    usedLibraryTemplateIds: ["99"],
    timelineTemplates: [
      {
        id: "m1",
        afterMessageIndex: 1,
        pinUserMessageId: "u1",
        createdAt: "2026-09-24T01:00:00Z",
        cards: [
          { ...twoEmails[0]!, template_id: "705452306273293937", fields: { compiled_html: "<p>A</p>" } },
        ],
      },
      {
        id: "m2",
        afterMessageIndex: 3,
        pinUserMessageId: "u2",
        createdAt: "2026-09-24T02:00:00Z",
        cards: [
          { ...twoEmails[1]!, template_id: "297643835470328932", fields: { compiled_html: "<p>B</p>" } },
        ],
      },
    ],
  },
  twoEmails,
);
assert(
  remappedLib.timelineTemplates?.[0]?.cards[0]?.template_id === "705452306273293937",
  "reconcile must not replace template A with latest email",
);
assert(
  remappedLib.timelineTemplates?.[1]?.cards[0]?.template_id === "297643835470328932",
  "reconcile must not replace template B",
);

resetGeneratePins("s-pin");
rememberGenerateUserPin("s-pin", [u1]);
bindGeneratePinToBatch("s-pin", "b1");
takePinForTemplatesReady("s-pin", draftOf([u1]), { generation_batch_id: "b1" });
rememberGenerateUserPin("s-pin", [u1, a1, u2]);
bindGeneratePinToBatch("s-pin", "b2");
const withA = appendCreatedChannelTemplates(
  draftOf([u1, a1, u2]),
  [card("e1", "email", "b1", "2026-09-24T01:00:00Z")],
  pinForNewGeneration(draftOf([u1]), { pinUserMessageId: "u1", pinUserOrdinal: 1 }, "b1"),
  "b1",
);
const pinB = takePinForTemplatesReady("s-pin", { ...withA, messages: [u1, a1, u2] }, {
  generation_batch_id: "b2",
});
assert(pinB.pinUserMessageId === "u2", "second generate pins to the second user ask");
const withBoth = appendCreatedChannelTemplates(
  { ...withA, messages: [u1, a1, u2] },
  [card("e2", "email", "b2", "2026-09-24T02:00:00Z")],
  pinB,
  "b2",
);
assert(channelsAt(withBoth, u1).join(",").includes("e1"), "card 1 stays under ask 1");
assert(!channelsAt(withBoth, u1).includes("e2"), "card 2 does not join ask 1");
assert(channelsAt(withBoth, u2).join(",").includes("e2"), "card 2 stays under ask 2");

const blockDraft = withBoth;
const blocksU1 = blocksAfterUserTurn(
  normalizeChatTimeline(blockDraft.timelineTemplates, blockDraft.messages),
  u1,
  blockDraft.messages,
);
const blocksU2 = blocksAfterUserTurn(
  normalizeChatTimeline(blockDraft.timelineTemplates, blockDraft.messages),
  u2,
  blockDraft.messages,
);
assert(blocksU1.length === 1 && blocksU1[0]?.batchId === "b1", "ask 1 has only batch 1");
assert(blocksU2.length === 1 && blocksU2[0]?.batchId === "b2", "ask 2 has only batch 2");
const a1Blocks = blocksForChatMessage(
  normalizeChatTimeline(blockDraft.timelineTemplates, blockDraft.messages),
  a1,
  blockDraft.messages,
);
assert(
  a1Blocks.length === 1 && a1Blocks[0]?.batchId === "b1",
  "card sits under the assistant reply for ask 1",
);
assert(
  blocksForChatMessage(
    normalizeChatTimeline(blockDraft.timelineTemplates, blockDraft.messages),
    u1,
    blockDraft.messages,
  ).length === 0,
  "card leaves the user bubble once the assistant reply exists",
);
assert(
  blocksForChatMessage(
    normalizeChatTimeline(blockDraft.timelineTemplates, blockDraft.messages),
    u2,
    blockDraft.messages,
  ).length === 1,
  "card stays under the user bubble until that turn has a reply",
);

resetGeneratePins("s-late");
rememberGenerateUserPin("s-late", [u1]);
bindGeneratePinToBatch("s-late", "b1");
rememberGenerateUserPin("s-late", [u1, a1, u2]);
const latePin = takePinForTemplatesReady("s-late", draftOf([u1, a1, u2]), {
  generation_batch_id: "b1",
});
assert(latePin.pinUserMessageId === "u1", "delayed ready for batch 1 stays on ask 1");

resetGeneratePins("s-launch-during");
rememberGenerateUserPin("s-launch-during", [u1]);
bindGeneratePinToBatch("s-launch-during", "b1");
const duringLaunch = rememberGenerateUserPin("s-launch-during", [u1, a1, u2]);
assert(
  duringLaunch?.pinUserMessageId === "u1",
  "launch while generate in flight keeps the create pin",
);
const readyDuringLaunch = takePinForTemplatesReady(
  "s-launch-during",
  draftOf([u1, a1, u2]),
  { generation_batch_id: "b1" },
);
assert(
  readyDuringLaunch.pinUserMessageId === "u1",
  "card stays on create ask, not a later launch message",
);
resetGeneratePins("s-launch-during");

resetGeneratePins("s-launch-before-progress");
rememberGenerateUserPin("s-launch-before-progress", [u1]);
assert(
  rememberGenerateUserPin("s-launch-before-progress", [u1, a1, u2])
    ?.pinUserMessageId === "u2",
  "before a generation batch is in flight, the pin follows the latest user ask",
);
resetGeneratePins("s-launch-before-progress");

resetGeneratePins("s-after-land");
rememberGenerateUserPin("s-after-land", [u1]);
bindGeneratePinToBatch("s-after-land", "b1");
takePinForTemplatesReady("s-after-land", draftOf([u1]), {
  generation_batch_id: "b1",
});
assert(
  rememberGenerateUserPin("s-after-land", [u1, a1, u2])?.pinUserMessageId ===
    "u2",
  "after cards land, the next generate can pin to a new ask",
);
resetGeneratePins("s-after-land");

const localThread = [u1, a1, u2];
const shortRemote = [u1];
const unioned = mergeMessagesServerWinsPendingLocal(localThread, shortRemote);
assert(
  unioned.some((m) => m.id === "a1") && unioned.some((m) => m.id === "u2"),
  "short server transcript must not wipe later local turns",
);
assert(
  unioned[0]?.id === "u1" &&
    unioned[1]?.id === "a1" &&
    unioned[2]?.id === "u2",
  "shown message order must not jump when the server sends a shorter history",
);
assert(
  mergeMessagesServerWinsPendingLocal(localThread, []).length ===
    localThread.length,
  "empty server transcript must keep the local chat",
);
assert(
  inFlightProgressForTurn({
    draft: {
      ...blockDraft,
      pendingGeneratePin: { pinUserMessageId: "u2", pinUserOrdinal: 2 },
    },
    msg: u2,
    messages: blockDraft.messages,
    progress: { generation_batch_id: "b2", status: "generating" },
    blocks: blocksU2,
  }) === false,
  "progress hides once that batch already has tiles",
);
assert(
  inFlightProgressForTurn({
    draft: {
      ...draftOf([u1, a1, u2]),
      pendingGeneratePin: { pinUserMessageId: "u2", pinUserOrdinal: 2 },
    },
    msg: u2,
    messages: [u1, a1, u2],
    progress: { generation_batch_id: "b9", status: "generating" },
    blocks: [],
  }) === true,
  "progress sits under the send pin while tiles are not in yet",
);

const pendingDump = appendMissingTimelineCardsFromSession(
  {
    ...draftOf([u1, a1, u2]),
    pendingGeneratePin: { pinUserMessageId: "u2", pinUserOrdinal: 2 },
  },
  history,
);
assert(
  channelsAt(pendingDump, u2).length === 0,
  "pendingGeneratePin must not dump session history onto the last ask",
);

resetGeneratePins("s-alias");
rememberGenerateUserPin("s-alias", [u1]);
bindGeneratePinToBatch("s-alias", "uuid-batch");
const aliasPin = takePinForTemplatesReady(
  "s-alias",
  {
    ...draftOf([u1]),
    generationPins: {
      "uuid-batch": { pinUserMessageId: "u1", pinUserOrdinal: 1 },
    },
  },
  {
    generation_batch_id: "960008197310217243",
    generation_batch_ids: ["uuid-batch", "960008197310217243"],
  },
);
assert(aliasPin.pinUserMessageId === "u1", "ready event aliases pin to persisted batch id");
const recoveredAlias = appendMissingTimelineCardsFromSession(
  {
    ...draftOf([u1]),
    generationPins: {
      "uuid-batch": { pinUserMessageId: "u1", pinUserOrdinal: 1 },
      "960008197310217243": { pinUserMessageId: "u1", pinUserOrdinal: 1 },
    },
  },
  [card("e-db", "email", "960008197310217243", "2026-09-24T08:00:00Z")],
);
assert(
  channelsAt(recoveredAlias, u1).join(",").includes("e-db"),
  "reopen recovers DB batch id when generationPins has the stable key",
);

const localWrong = {
  ...draftOf([u1, a1, u2]),
  timelineTemplates: [
    {
      id: "m-wrong",
      afterMessageIndex: 3,
      pinUserMessageId: "u2",
      pinUserOrdinal: 2,
      createdAt: "2026-09-24T02:00:00Z",
      cards: [card("e1", "email", "b1", "2026-09-24T01:00:00Z")],
    },
  ],
};
const fromServer = sessionPayloadToDraft(
  "s1",
  {
    messages: [
      { id: "u1", role: "user", text: "Create email and app", created_at: "2026-09-24T00:00:00Z" },
      { id: "a1", role: "assistant", text: "Ready", created_at: "2026-09-24T00:00:01Z" },
      { id: "u2", role: "user", text: "Regenerate", created_at: "2026-09-24T00:00:02Z" },
    ],
    campaign: { name: "Test", goal: "Test" },
    channels: ["email"],
    ui: {
      timelineTemplates: [
        {
          id: "m-right",
          afterMessageIndex: 1,
          pinUserMessageId: "u1",
          pinUserOrdinal: 1,
          createdAt: "2026-09-24T01:00:00Z",
          cards: [card("e1", "email", "b1", "2026-09-24T01:00:00Z")],
        },
      ],
      generationPins: { b1: { pinUserMessageId: "u1", pinUserOrdinal: 1 } },
      pendingGeneratePin: { pinUserMessageId: "u2", pinUserOrdinal: 2 },
    },
  },
  { local: localWrong },
);
assert(
  channelsAt(fromServer, u2).join(",").includes("e1"),
  "shown card stays on that user turn — not moved to an older ask",
);
assert(
  !channelsAt(fromServer, u1).includes("email:e1"),
  "shown card must not jump to an earlier line",
);
assert(
  fromServer.messages.some((m) => m.id === "u1") &&
    fromServer.messages.some((m) => m.id === "a1") &&
    fromServer.messages.some((m) => m.id === "u2"),
  "shown messages must not disappear on session hydrate",
);
assert(
  fromServer.pendingGeneratePin === undefined,
  "session pendingGeneratePin must not hydrate on another browser",
);

const localOnlyCard = sessionPayloadToDraft(
  "s-local-card",
  {
    messages: [
      { id: "u1", role: "user", text: "Create email and app", created_at: "2026-09-24T00:00:00Z" },
    ],
    campaign: { name: "Test", goal: "Test" },
    channels: ["email"],
    ui: {
      timelineTemplates: [],
      generationPins: {},
    },
  },
  {
    local: {
      ...draftOf([u1]),
      timelineTemplates: [
        {
          id: "m-local",
          afterMessageIndex: 1,
          pinUserMessageId: "u1",
          pinUserOrdinal: 1,
          createdAt: "2026-09-24T01:00:00Z",
          cards: [card("e-local", "email", "b-local", "2026-09-24T01:00:00Z")],
        },
      ],
      generationPins: {
        "b-local": { pinUserMessageId: "u1", pinUserOrdinal: 1 },
      },
    },
  },
);
assert(
  channelsAt(localOnlyCard, u1).join(",").includes("e-local"),
  "reopen must keep locally shown cards when the session timeline is empty",
);

const savedUi = draftToSessionPayload({
  ...fromServer,
  pendingGeneratePin: { pinUserMessageId: "u2", pinUserOrdinal: 2 },
}).ui as { pendingGeneratePin?: unknown };
assert(
  savedUi?.pendingGeneratePin === undefined,
  "in-flight pendingGeneratePin must not persist on the session",
);

const mergedSendNow = mergeMessagesServerWinsPendingLocal(
  [
    {
      id: "local-1",
      role: "user",
      text: "send now",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  [
    {
      id: "server-1",
      role: "user",
      text: "send now",
      createdAt: "2026-01-01T00:00:01.000Z",
      imageUrl: "https://cdn.example/leaked-edit.png",
    },
  ],
);
assert(
  mergedSendNow.length === 1,
  "merge must not duplicate user rows when only image differs",
);
assert(
  !mergedSendNow[0]?.imageUrl,
  "merge must not backfill thumbnails onto text-only local bubbles without id match",
);

console.log("campaign-template-timeline.selftest ok");
