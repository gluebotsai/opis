import { describe, expect, it } from "vitest";

import type { ContactGuidedDraft } from "./assistant-api";
import {
  coerceContactActive,
  contactDraftFromAssistantHtml,
  contactPhonesEquivalent,
  listContactUpdateChanges,
  mergeContactGuidedDraft,
} from "./contact-guided-draft";

describe("mergeContactGuidedDraft", () => {
  it("preserves collected values when a later event is partial", () => {
    const previous: ContactGuidedDraft = {
      mode: "create",
      fields: { firstName: "Asha", primaryEmail: "asha@example.com" },
      nextField: "primaryPhone",
      skippedFields: ["lastName"],
    };

    const merged = mergeContactGuidedDraft(previous, {
      mode: "create",
      fields: { primaryPhone: "+44 7700 900123" },
      nextField: null,
      nextQuestion: null,
      ready: true,
    });

    expect(merged.fields).toEqual({
      firstName: "Asha",
      primaryEmail: "asha@example.com",
      primaryPhone: "+44 7700 900123",
    });
    expect(merged.skippedFields).toEqual(["lastName"]);
    expect(merged.ready).toBe(true);
  });

  it("lets a newly supplied value restore a previously skipped field", () => {
    const previous: ContactGuidedDraft = {
      mode: "create",
      fields: { firstName: "Asha" },
      nextField: "primaryEmail",
      skippedFields: ["lastName"],
    };

    const merged = mergeContactGuidedDraft(previous, {
      mode: "create",
      fields: { lastName: "Patel" },
      nextField: "primaryEmail",
      skippedFields: [],
    });

    expect(merged.fields.lastName).toBe("Patel");
    expect(merged.skippedFields).toEqual([]);
  });
});

describe("listContactUpdateChanges", () => {
  const fields = [
    { key: "firstName" as const, label: "First name" },
    { key: "lastName" as const, label: "Last name" },
    { key: "city" as const, label: "City" },
    { key: "region" as const, label: "Region" },
  ];

  it("keeps only fields that differ from the current profile", () => {
    const changes = listContactUpdateChanges(
      { firstName: "Sanju", lastName: "Ravi", city: "Chennai", region: "Tamil Nadu" },
      { firstName: "Sanju", lastName: "Ravi", city: "Chennai" },
      fields,
    );

    expect(changes).toEqual([
      { id: "region", key: "region", label: "Region", from: undefined, to: "Tamil Nadu" },
    ]);
  });

  it("lists staged values when no current profile is available", () => {
    const changes = listContactUpdateChanges(
      { firstName: "Sanju", lastName: "Ravi" },
      null,
      fields,
    );

    expect(changes.map((change) => change.key)).toEqual(["firstName", "lastName"]);
  });

  it("does not treat omitted draft fields as clears", () => {
    const changes = listContactUpdateChanges(
      { region: "Tamil Nadu" },
      { firstName: "Sanju", lastName: "Ravi", city: "Chennai" },
      fields,
    );

    expect(changes).toEqual([
      { id: "region", key: "region", label: "Region", from: undefined, to: "Tamil Nadu" },
    ]);
  });

  it("ignores a country-code prefix on the same phone number", () => {
    const changes = listContactUpdateChanges(
      { primaryPhone: "919007788990", city: "Bengaluru" },
      { primaryPhone: "9007788990", city: "Chennai" },
      [
        { key: "primaryPhone", label: "Primary phone" },
        { key: "city", label: "City" },
      ],
    );

    expect(changes).toEqual([
      { id: "city", key: "city", label: "City", from: "Chennai", to: "Bengaluru" },
    ]);
  });

  it("treats Inactive labels as a real status change", () => {
    const changes = listContactUpdateChanges(
      { isActive: "Inactive" },
      { isActive: true },
      [{ key: "isActive", label: "Status" }],
    );

    expect(changes).toEqual([
      { id: "isActive", key: "isActive", label: "Status", from: true, to: "Inactive" },
    ]);
    expect(coerceContactActive("Inactive")).toBe(false);
    expect(contactPhonesEquivalent("9007788990", "91 9007788990")).toBe(true);
  });

  it("lists one custom field and does not print the stored object", () => {
    const changes = listContactUpdateChanges(
      { customFields: { "customer type": "VIP" } },
      { customFields: { isActive: true } },
      [{ key: "customFields", label: "Custom fields" }],
    );

    expect(changes).toEqual([
      {
        id: "customFields:customer type",
        key: "customFields",
        label: "customer type",
        from: undefined,
        to: "VIP",
      },
    ]);
  });
});

describe("contactDraftFromAssistantHtml", () => {
  it("builds a ready update draft from a field preview table", () => {
    const draft = contactDraftFromAssistantHtml(
      `
      <p>I've prepared those updates for Sanju Ravi.</p>
      <table>
        <thead>
          <tr><th>FIELD</th><th>CURRENT VALUE</th><th>NEW VALUE</th></tr>
        </thead>
        <tbody>
          <tr><td>Region</td><td>—</td><td>Kerala</td></tr>
          <tr><td>Language</td><td>—</td><td>Tamil</td></tr>
        </tbody>
      </table>
      `,
      "sanju-1",
    );

    expect(draft).toEqual({
      mode: "update",
      contactId: "sanju-1",
      fields: { region: "Kerala", language: "Tamil" },
      nextField: null,
      nextQuestion: null,
      skippedFields: [],
      ready: true,
    });
  });

  it("coerces Active and Inactive table values to booleans", () => {
    const draft = contactDraftFromAssistantHtml(
      `
      <table>
        <thead>
          <tr><th>FIELD</th><th>CURRENT VALUE</th><th>NEW VALUE</th></tr>
        </thead>
        <tbody>
          <tr><td>Status</td><td>Active</td><td>Inactive</td></tr>
        </tbody>
      </table>
      `,
      "kavya-1",
    );

    expect(draft?.fields).toEqual({ isActive: false });
  });

  it("ignores tables that are not field previews", () => {
    expect(
      contactDraftFromAssistantHtml(
        "<table><tr><th>Queue</th><th>Waiting</th></tr><tr><td>Support</td><td>3</td></tr></table>",
      ),
    ).toBeNull();
  });
});
