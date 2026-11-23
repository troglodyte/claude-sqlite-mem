import { test } from "node:test";
import assert from "node:assert/strict";
import { rankPinnedRows, collapseRepeats } from "../src/lib/pinnedRanking.js";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 23);
let nextRid = 1;

// A stored standing-fact row as getPinnedFacts reads it.
function pinnedRowFactory({ entityId, sessionId, daysAgo = 0, text = `fact ${nextRid}` }) {
  const rid = nextRid++;
  return { entityId, entity: `constraint:${entityId}`, type: "constraint", sessionId, createdAt: NOW - daysAgo * DAY_MS, rid, text };
}

const newestFirst = (pinnedRows) => [...pinnedRows].sort((a, b) => b.createdAt - a.createdAt || b.rid - a.rid);

test("an entity restated in more sessions outranks a one-off of the same age", () => {
  const pinnedRows = newestFirst([
    pinnedRowFactory({ entityId: "hot", sessionId: "s1", daysAgo: 1 }),
    pinnedRowFactory({ entityId: "hot", sessionId: "s2", daysAgo: 1 }),
    pinnedRowFactory({ entityId: "hot", sessionId: "s3", daysAgo: 1 }),
    pinnedRowFactory({ entityId: "one-off", sessionId: "s4", daysAgo: 0 }),
  ]);

  const rankedRows = rankPinnedRows(pinnedRows, { now: NOW });

  assert.equal(rankedRows[0].entityId, "hot");
});

// Ranking by raw session count hid a preference stated today until it had been
// restated in about seven sessions; newest-first had shown it at once.
test("a standing fact stated today outranks one restated in several sessions months ago", () => {
  const pinnedRows = newestFirst([
    pinnedRowFactory({ entityId: "today", sessionId: "s9", daysAgo: 0 }),
    ...["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((sessionId) =>
      pinnedRowFactory({ entityId: "stale", sessionId, daysAgo: 90 })
    ),
  ]);

  const rankedRows = rankPinnedRows(pinnedRows, { now: NOW });

  assert.equal(rankedRows[0].entityId, "today");
});

test("each entity contributes one fact per round, newest first within it", () => {
  const pinnedRows = newestFirst([
    pinnedRowFactory({ entityId: "hot", sessionId: "s1", daysAgo: 3, text: "hot oldest" }),
    pinnedRowFactory({ entityId: "hot", sessionId: "s2", daysAgo: 2, text: "hot middle" }),
    pinnedRowFactory({ entityId: "hot", sessionId: "s3", daysAgo: 1, text: "hot newest" }),
    pinnedRowFactory({ entityId: "cold", sessionId: "s4", daysAgo: 5, text: "cold only" }),
  ]);

  const rankedRows = rankPinnedRows(pinnedRows, { now: NOW });

  assert.deepEqual(
    rankedRows.map((row) => row.text),
    ["hot newest", "cold only", "hot middle", "hot oldest"]
  );
});

test("collapseRepeats keeps the first of a group of near-identical facts", () => {
  const orderedRows = [
    { text: "alpha bravo charlie delta echo foxtrot golf hotel india" },
    { text: "alpha bravo charlie delta echo foxtrot golf hotel" },
    { text: "a different topic entirely" },
  ];

  const { facts, collapsed } = collapseRepeats(orderedRows);

  assert.deepEqual(facts.map((row) => row.text), [orderedRows[0].text, orderedRows[2].text]);
  assert.equal(collapsed, 1);
});

test("collapseRepeats stops examining rows once the kept facts fill maxChars", () => {
  const orderedRows = ["one unique", "two unique", "three unique", "four unique"].map((text) => ({ text }));

  const { facts } = collapseRepeats(orderedRows, { maxChars: 15, sizeOf: (row) => row.text.length });

  assert.deepEqual(facts.map((row) => row.text), ["one unique", "two unique"]);
});
