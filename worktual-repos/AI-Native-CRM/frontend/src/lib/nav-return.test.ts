/**
 * Lightweight unit checks (run: npx tsx src/lib/nav-return.test.ts)
 */
import {
  arrivalHref,
  backTargetIsList,
  clearNavReturnStorage,
  elementAtScrollPath,
  isModuleHome,
  isSameEntry,
  navModuleKey,
  noteNavigation,
  previousInAppHref,
  readPageField,
  rememberModuleHref,
  returnHref,
  scrollPath,
  sourceRecordBack,
  writePageField,
  type ScrollNode,
} from "./nav-return";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

const store = memoryStore();

assert(navModuleKey("/contact/abc") === "contact", "contact detail stays in contact");
assert(navModuleKey("/sales/quotes/1") === "sales", "quotes stay with sales");
assert(navModuleKey("/sales/calendar") === "sales/calendar", "calendar is its own module");
assert(navModuleKey("/marketing/seo/keywords") === "marketing/seo", "marketing child is its own module");
assert(
  navModuleKey("/configuration/email") === "configuration/email",
  "configuration child is its own module",
);

rememberModuleHref("/company/co-1", "/company/co-1?tab=people", store);
assert(
  returnHref("/company", store) === "/company/co-1?tab=people",
  "company nav returns to the last company page",
);
assert(returnHref("/contact", store) === "/contact", "a new module opens its own root");
rememberModuleHref("/contact/p-1", "/contact/p-1?tab=tasks", store);
assert(
  returnHref("/contact", store) === "/contact/p-1?tab=tasks",
  "contact nav returns to the last contact, including the tab",
);

noteNavigation("/company/co-1", "PUSH", store);
noteNavigation("/contact/p-1?tab=tasks", "PUSH", store);
assert(
  previousInAppHref(store) === "/company/co-1",
  "back from the contact returns to the company page that was open",
);
noteNavigation("/company/co-1", "POP", store);
assert(previousInAppHref(store) === null, "the trail stops at the first page");

assert(isModuleHome("/company", "/company"), "the company list is the module home");
assert(!isModuleHome("/company/co-1", "/company"), "a company record is not the module home");
assert(
  !isModuleHome("/contact", "/contact", "?view=detail&id=p-1"),
  "an open contact on the list url is not the module home",
);
assert(isModuleHome("/contact", "/contact", ""), "the contact list with no query is the module home");
assert(
  sourceRecordBack("/contact?view=detail&id=p-1")?.label === "Back to contact",
  "an open contact is a back target",
);
assert(
  sourceRecordBack("/contact?view=detail&id=p-1")?.to === "/contact?view=detail&id=p-1",
  "back returns to the same contact",
);
assert(sourceRecordBack("/company") === null, "the company list keeps its own back label");
assert(sourceRecordBack("/company/co-1")?.label === "Back to company", "a company record is a back target");
assert(sourceRecordBack("/sales/deal-1")?.label === "Back to deal", "a deal record is a back target");

noteNavigation("/contact?view=detail&id=p-1", "PUSH", store);
assert(
  arrivalHref("/company/co-1", store) === "/contact?view=detail&id=p-1",
  "before the company page is recorded, back still finds the contact",
);
noteNavigation("/company/co-1", "PUSH", store);
assert(
  arrivalHref("/company/co-1", store) === "/contact?view=detail&id=p-1",
  "after the company page is recorded, back still finds the contact",
);
noteNavigation("/company", "PUSH", store);
noteNavigation("/company/co-1", "PUSH", store);
assert(
  sourceRecordBack(arrivalHref("/company/co-1", store)) === null,
  "opening a company from the company list keeps All companies",
);

noteNavigation("/sales/deal-9", "PUSH", store);
noteNavigation("/contact", "PUSH", store);
assert(
  arrivalHref("/contact?view=detail&id=p-1", store) === "/contact",
  "a contact opened on the list url comes from the list, not the page before it",
);
assert(
  sourceRecordBack(arrivalHref("/contact?view=detail&id=p-1", store)) === null,
  "back from that contact stays on the contact list",
);
noteNavigation("/contact?view=detail&id=p-1", "PUSH", store);
assert(
  arrivalHref("/contact?view=detail&id=p-1", store) === "/contact",
  "the arrival is the same once the contact url is recorded",
);

// Back out of a company location. The trail still ends with the location until
// the layout effect truncates it, so POP must not read it as where to go back.
clearNavReturnStorage(store);
noteNavigation("/company", "PUSH", store);
noteNavigation("/company/co-1", "PUSH", store);
noteNavigation("/company/co-1/locations/loc-1", "PUSH", store);
assert(
  arrivalHref("/company/co-1", store, "POP") === "/company",
  "back out of a location does not treat the location as the arrival",
);
assert(
  sourceRecordBack(arrivalHref("/company/co-1", store, "POP")) === null,
  "the company page keeps All companies instead of pointing into the location",
);
assert(
  sourceRecordBack(arrivalHref("/company/co-1", store, "PUSH"))?.label ===
    "Back to location",
  "reaching the company from a location by link still offers Back to location",
);
noteNavigation("/company/co-1", "POP", store);
assert(
  arrivalHref("/company/co-1", store, "POP") === "/company",
  "the arrival is unchanged once the trail is truncated",
);

// The location page's own Back link targets the company record, which is not a
// module list. It still has to go back through history, or the location stays
// on the trail and the company page offers to return into it.
assert(
  !backTargetIsList("/company/co-1"),
  "a company record is not a module list",
);
assert(
  isSameEntry("/company/co-1", "/company/co-1"),
  "the back target is the page the user came from",
);
assert(
  !isSameEntry("/contact?view=detail&id=p-1", "/contact"),
  "a contact opened on the list url is not the list",
);
assert(
  !isSameEntry("/company/co-2", "/company/co-1"),
  "a different company is a different page",
);

assert(backTargetIsList("/contact"), "contact list is a back target");
assert(backTargetIsList("/sales/quotes"), "quotes list is a back target");
assert(!backTargetIsList("/sales/deal-1"), "a deal link stays on that deal");
assert(backTargetIsList("/marketing/campaigns"), "a marketing section is a back target");

writePageField("/company/co-1", "activityType", "call", store);
assert(readPageField("/company/co-1", "activityType", store) === "call", "page selection is kept");

function node(): ScrollNode & { kids: ScrollNode[] } {
  const kids: ScrollNode[] = [];
  const self = {
    parentElement: null as ScrollNode | null,
    kids,
    children: {
      item: (index: number) => kids[index] ?? null,
    },
  };
  return self;
}
const root = node();
const row = node();
row.parentElement = root;
root.kids.push(row);
const path = scrollPath(row, root);
assert(path === "0", "a row's scroll path is its child index");
assert(elementAtScrollPath(root, path) === row, "the path finds the same row");
assert(elementAtScrollPath(root, "root") === root, "root path is the workspace");

clearNavReturnStorage(store);
assert(returnHref("/company", store) === "/company", "logout clears the remembered page");
assert(previousInAppHref(store) === null, "logout clears the back trail");

console.log("nav-return.test.ts ok");
