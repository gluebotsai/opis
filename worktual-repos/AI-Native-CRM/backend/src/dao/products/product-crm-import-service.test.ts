import { describe, expect, it } from "vitest";
import { csvToCatalogRows } from "./product-csv";

describe("crm product CSV import", () => {
  it("maps brand, subcategory, stock, product URL, and CDP active=false to archived", () => {
    const csv = `name,sku,brand,category,subcategory,stock,product_url,price,currency,status,active
Starter Plan,SKU-START,Acme,Plans,Starter,,,49,USD,active,true
Retired Plan,SKU-OLD,Acme,Plans,Legacy,,,9,USD,active,false
Pulse Earbuds,WT-EARBUD-BLK,Worktual Home,Audio,Earbuds,50,https://shop.example.com/pulse,79,USD,active,true
`;
    const { rows, errors } = csvToCatalogRows(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      name: "Starter Plan",
      sku: "SKU-START",
      brand: "Acme",
      category: "Plans",
      subcategory: "Starter",
      status: "active",
      stockOnHand: null,
      productUrl: null,
    });
    expect(rows[1]).toMatchObject({
      name: "Retired Plan",
      sku: "SKU-OLD",
      brand: "Acme",
      subcategory: "Legacy",
      status: "archived",
    });
    expect(rows[2]).toMatchObject({
      name: "Pulse Earbuds",
      sku: "WT-EARBUD-BLK",
      stockOnHand: 50,
      productUrl: "https://shop.example.com/pulse",
    });
  });
});
