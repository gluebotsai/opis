/**
 * run: npx tsx --tsconfig tsconfig.json src/service/zoominfo/zoominfo-search.test.ts
 */
import {
  mapZoominfoSearchRow,
  zoominfoSearchParameters,
  zoominfoSearchRows,
} from "./zoominfo-search";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const broad = zoominfoSearchParameters({}, 5);
assert(broad.pageSize === 5, "page size follows the requested limit");
assert(broad.page === 1, "the first search starts on page 1");
const nextPage = zoominfoSearchParameters({}, 25, 2);
assert(nextPage.page === 2 && nextPage.pageSize === 25, "later pages stay requested");
assert(broad.jobTitle === "Manager", "an empty pull searches a broad title");
assert(
  !("companyName" in broad),
  "empty criteria must not invent a company name",
);

const hint = zoominfoSearchParameters(
  { productFitHint: "actively searching for our products" },
  1,
);
assert(
  hint.jobTitle === "Manager" && !("companyName" in hint),
  "a product-fit sentence is not sent as a company name",
);

const titled = zoominfoSearchParameters({ titles: ["CEO"] }, 10);
assert(titled.jobTitle === "CEO", "an explicit title is the search filter");

const rows = zoominfoSearchRows({
  data: [
    {
      id: "7395978367",
      attributes: {
        firstName: "Jameson",
        lastName: "Ta",
        jobTitle: "Chief Executive Officer & General Manager",
        company: { name: "Lane Transit District" },
        contactAccuracyScore: 89,
      },
    },
  ],
});
assert(rows.length === 1, "gateway data.data is the contact list");
const mapped = mapZoominfoSearchRow(rows[0]);
assert(mapped?.firstName === "Jameson", "first name mapped");
assert(mapped?.companyName === "Lane Transit District", "company name mapped");
assert(
  (mapped?.providerPayload as { zoominfoId?: string }).zoominfoId ===
    "7395978367",
  "zoominfo id kept for enrich on import",
);

console.log("zoominfo-search.test.ts: ok");
