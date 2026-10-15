/**
 * run: npx tsx src/service/auth/onboarding-dashboard.test.ts
 */
import {
  isInternalServiceKeyAuthorized,
  onboardingHomePath,
  publicAppUrl,
} from "./onboarding-dashboard";
import {
  consumeOnboardingCode,
  generateOnboardingCode,
  saveOnboardingCode,
} from "./onboarding-code-store";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(onboardingHomePath("marketing") === "/marketing/dashboard", "marketing home");
assert(onboardingHomePath("marketer") === "/marketing/dashboard", "marketer alias");
assert(onboardingHomePath("admin") === "/dashboard", "admin home");
assert(onboardingHomePath("sales_rep") === "/dashboard", "sales home");
assert(onboardingHomePath("finance") === "/dashboard", "finance home");
assert(onboardingHomePath("viewer") === "/dashboard", "viewer home");

const prevKey = process.env.INTERNAL_SERVICE_KEY;
const prevApp = process.env.PUBLIC_APP_URL;
const prevNext = process.env.NEXT_PUBLIC_APP_URL;
const prevFe = process.env.FRONTEND_ORIGIN;
try {
  process.env.INTERNAL_SERVICE_KEY = "crm-onboarding-test-secret";
  assert(
    !isInternalServiceKeyAuthorized(undefined),
    "missing header is unauthorized",
  );
  assert(
    !isInternalServiceKeyAuthorized("wrong"),
    "wrong key is unauthorized",
  );
  assert(
    isInternalServiceKeyAuthorized("crm-onboarding-test-secret"),
    "matching key is authorized",
  );

  delete process.env.PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.FRONTEND_ORIGIN;
  process.env.PUBLIC_APP_URL = "https://rebuild-crm.worktual.com/";
  assert(
    publicAppUrl() === "https://rebuild-crm.worktual.com",
    "strips trailing slash",
  );
} finally {
  if (prevKey === undefined) delete process.env.INTERNAL_SERVICE_KEY;
  else process.env.INTERNAL_SERVICE_KEY = prevKey;
  if (prevApp === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = prevApp;
  if (prevNext === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = prevNext;
  if (prevFe === undefined) delete process.env.FRONTEND_ORIGIN;
  else process.env.FRONTEND_ORIGIN = prevFe;
}

const a = generateOnboardingCode();
const b = generateOnboardingCode();
assert(a.length > 20 && a !== b, "codes are unique");

await saveOnboardingCode(a, "1001");
const first = await consumeOnboardingCode(a);
const second = await consumeOnboardingCode(a);
assert(first === "1001", "first consume returns user id");
assert(second === null, "second consume is single-use");

console.log("onboarding-dashboard.test.ts ok");
