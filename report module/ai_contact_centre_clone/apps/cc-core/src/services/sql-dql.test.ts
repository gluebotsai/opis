import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  conversationHandledByUserCondition,
} from "./reporting-attribution.js";
import {
  enforceAgentScopedConversations,
  enforceOrgScopedConversations,
  extractColumns,
  validateDqlQuery,
} from "./sql-dql.js";

const ORG = "1000";
const USER = "1003";

describe("validateDqlQuery", () => {
  it("accepts SELECT", () => {
    const sql = validateDqlQuery("SELECT id FROM ccass.conversations");
    assert.match(sql, /SELECT/i);
  });

  it("accepts WITH CTE", () => {
    const sql = validateDqlQuery(
      "WITH x AS (SELECT 1 AS n) SELECT * FROM x",
    );
    assert.match(sql, /^WITH/i);
  });

  it("rejects INSERT", () => {
    assert.throws(
      () => validateDqlQuery("INSERT INTO ccass.conversations (id) VALUES ('x')"),
      /DQL restriction/,
    );
  });

  it("rejects multi-statement", () => {
    assert.throws(
      () => validateDqlQuery("SELECT 1; DROP TABLE ccass.conversations"),
      /Multi-statement/,
    );
  });

  it("rejects EXPLAIN", () => {
    assert.throws(() => validateDqlQuery("EXPLAIN SELECT 1"), /SELECT or WITH/);
  });
});

describe("conversationHandledByUserCondition", () => {
  it("matches direct assignment and assignment history", () => {
    const condition = conversationHandledByUserCondition(USER);
    assert.match(condition, /assigned_user_id = '1003'::bigint/);
    assert.match(condition, /conversation_assignments/);
    assert.match(condition, /accepted', 'ended/);
  });

  it("rejects non-numeric user ids", () => {
    assert.throws(
      () => conversationHandledByUserCondition("not-an-id"),
      /Invalid user id/,
    );
  });
});

describe("enforceAgentScopedConversations", () => {
  it("wraps SELECT with scoped CTE using bigint ids", () => {
    const scoped = enforceAgentScopedConversations(
      "SELECT channel, COUNT(*) AS n FROM ccass.conversations GROUP BY channel",
      ORG,
      USER,
    );
    assert.match(scoped, /__agent_conversations AS/);
    assert.match(scoped, /organization_id = '1000'::bigint/);
    assert.match(scoped, /setup_user_id = '1003'::bigint/);
    assert.match(scoped, /FROM __agent_conversations/);
    assert.doesNotMatch(scoped, /FROM ccass\.conversations GROUP/i);
  });

  it("injects into existing WITH", () => {
    const scoped = enforceAgentScopedConversations(
      "WITH daily AS (SELECT DATE_TRUNC('day', assigned_at) AS day FROM ccass.conversations) SELECT * FROM daily",
      ORG,
      USER,
    );
    assert.match(scoped, /^WITH __agent_conversations AS/i);
    assert.match(scoped, /,\s*daily AS/i);
  });

  it("leaves unrelated SQL unchanged", () => {
    const sql = "SELECT 1 AS n";
    assert.equal(enforceAgentScopedConversations(sql, ORG, USER), sql);
  });

  it("rejects uuid ids", () => {
    assert.throws(
      () =>
        enforceAgentScopedConversations(
          "SELECT id FROM ccass.conversations",
          "ce4ff326-4c0e-43f2-a978-e6b494cd0775",
          USER,
        ),
      /Invalid organization id/,
    );
  });
});

describe("enforceOrgScopedConversations", () => {
  it("wraps SELECT with org-scoped CTE", () => {
    const scoped = enforceOrgScopedConversations(
      "SELECT channel, COUNT(*) AS n FROM ccass.conversations GROUP BY channel",
      ORG,
    );
    assert.match(scoped, /__org_conversations AS/);
    assert.match(scoped, /organization_id = '1000'::bigint/);
    assert.doesNotMatch(scoped, /assigned_user_id/);
  });
});

describe("extractColumns", () => {
  it("reads keys from first row", () => {
    assert.deepEqual(extractColumns([{ a: 1, b: 2 }]), ["a", "b"]);
  });

  it("returns empty for no rows", () => {
    assert.deepEqual(extractColumns([]), []);
  });
});
