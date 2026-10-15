/**
 * run: npx tsx --tsconfig tsconfig.json src/dao/notifications/notify-admins.test.ts
 */
import {
  ADMIN_ATTENTION_NOTIFICATION_KINDS,
  pickNotificationRecipientIds,
} from "./notify-admins";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  JSON.stringify(
    pickNotificationRecipientIds({
      kind: "deal_created",
      activeOwnerIds: ["owner-1"],
      adminIds: ["admin-1", "admin-2"],
    }),
  ) === JSON.stringify(["owner-1"]),
  "operational → assigned owner only",
);

assert(
  JSON.stringify(
    pickNotificationRecipientIds({
      kind: "quote_sent",
      activeOwnerIds: [],
      adminIds: ["admin-1", "admin-2"],
    }).sort(),
  ) === JSON.stringify(["admin-1", "admin-2"]),
  "unassigned operational → admins",
);

assert(
  JSON.stringify(
    pickNotificationRecipientIds({
      kind: "invoice_overdue",
      activeOwnerIds: ["owner-1"],
      adminIds: ["admin-1"],
    }).sort(),
  ) === JSON.stringify(["admin-1", "owner-1"]),
  "overdue → owner + admin",
);

assert(
  JSON.stringify(
    pickNotificationRecipientIds({
      kind: "meeting_miss",
      activeOwnerIds: ["owner-1"],
      adminIds: ["admin-1", "admin-2"],
      excludeUserId: "admin-1",
    }).sort(),
  ) === JSON.stringify(["admin-2", "owner-1"]),
  "meeting miss excludes actor admin",
);

assert(
  JSON.stringify(
    pickNotificationRecipientIds({
      kind: "lead_deleted",
      activeOwnerIds: [],
      adminIds: ["admin-1"],
    }),
  ) === JSON.stringify(["admin-1"]),
  "lead deleted → admins",
);

assert(
  pickNotificationRecipientIds({
    kind: "deal_won",
    activeOwnerIds: ["owner-1"],
    adminIds: ["admin-1"],
    excludeUserId: "owner-1",
  }).length === 0,
  "owner acting on own record → no self-notify",
);

assert(
  ADMIN_ATTENTION_NOTIFICATION_KINDS.has("invoice_overdue"),
  "overdue is admin attention",
);
assert(
  ADMIN_ATTENTION_NOTIFICATION_KINDS.has("meeting_miss"),
  "meeting miss is admin attention",
);
assert(
  ADMIN_ATTENTION_NOTIFICATION_KINDS.has("lead_deleted"),
  "lead deleted is admin attention",
);
assert(
  !ADMIN_ATTENTION_NOTIFICATION_KINDS.has("quote_sent"),
  "quote sent is operational",
);

console.log("notify-admins recipient picker ok");
