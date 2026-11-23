// Pure ordering rules for the standing facts injected at SessionStart. No I/O:
// graph.js reads the rows, these decide which ones a session sees.
import { setOverlap, wordSet } from "./similarity.js";

const DAY_MS = 86_400_000;

// A session's say in an entity's rank halves every two weeks. Raw session count
// hid a preference stated today until it had been restated in ~7 sessions (the
// 15th-ranked entity on the busiest live project had 7); with decay, one session
// today (weight 1) outranks seven sessions three months ago (~0.08).
export const SESSION_HALF_LIFE_DAYS = 14;

// Measured on 693 standing facts (engine spec, "Fix 2"): every pair at 0.8 or
// more was a repeat, and the next pair down (0.73) was two different tickets.
// Reworded repeats score as low as 0.33, below pairs that genuinely differ, so
// they are only listed for review (0.3), never collapsed.
export const REPEAT_COLLAPSE_OVERLAP = 0.8;
export const REPEAT_REVIEW_OVERLAP = 0.3;

// Each session counts once per entity, weighted by its latest write there. A row
// with no session (a manual write) counts as its own session.
function entityGroupsByWeight(pinnedRows, now, halfLifeDays) {
  const entityGroups = new Map();
  for (const pinnedRow of pinnedRows) {
    const entityGroup = entityGroups.get(pinnedRow.entityId) ?? { rows: [], latestWriteBySession: new Map(), newestAt: pinnedRow.createdAt };
    const sessionKey = pinnedRow.sessionId ?? `row:${pinnedRow.rid}`;
    const latestWriteAt = entityGroup.latestWriteBySession.get(sessionKey) ?? -Infinity;
    entityGroup.rows.push(pinnedRow);
    entityGroup.latestWriteBySession.set(sessionKey, Math.max(latestWriteAt, pinnedRow.createdAt));
    entityGroups.set(pinnedRow.entityId, entityGroup);
  }
  const weightOf = (entityGroup) =>
    [...entityGroup.latestWriteBySession.values()].reduce(
      (weight, writtenAt) => weight + 0.5 ** (Math.max(0, now - writtenAt) / (halfLifeDays * DAY_MS)),
      0
    );
  return [...entityGroups.values()]
    .map((entityGroup) => ({ ...entityGroup, weight: weightOf(entityGroup) }))
    .sort((a, b) => b.weight - a.weight || b.newestAt - a.newestAt);
}

/**
 * Orders standing-fact rows (given newest first) for injection: entities by
 * recency-decayed session weight, one fact from each per round so one busy
 * entity's rewordings can't crowd every other standing fact out.
 */
export function rankPinnedRows(pinnedRows, { now = Date.now(), halfLifeDays = SESSION_HALF_LIFE_DAYS } = {}) {
  const entityGroups = entityGroupsByWeight(pinnedRows, now, halfLifeDays);
  const deepestGroupSize = Math.max(0, ...entityGroups.map((entityGroup) => entityGroup.rows.length));
  const rankedRows = [];
  for (let round = 0; round < deepestGroupSize; round++) {
    for (const entityGroup of entityGroups) {
      if (round < entityGroup.rows.length) {
        rankedRows.push(entityGroup.rows[round]);
      }
    }
  }
  return rankedRows;
}

/**
 * Keeps the first of each group of near-identical facts, so callers pass rows
 * best first. Stops examining rows once the kept facts' `sizeOf` total exceeds
 * `maxChars`: a project with a thousand standing facts otherwise costs a million
 * comparisons (six seconds, measured) to produce a block that shows fourteen.
 */
export function collapseRepeats(orderedRows, { maxChars = Infinity, sizeOf = () => 0 } = {}) {
  const facts = [];
  const keptWordSets = [];
  let keptChars = 0;
  let collapsed = 0;
  for (const row of orderedRows) {
    if (keptChars > maxChars) {
      break;
    }
    const rowWords = wordSet(row.text);
    if (keptWordSets.some((keptWords) => setOverlap(keptWords, rowWords) >= REPEAT_COLLAPSE_OVERLAP)) {
      collapsed += 1;
    } else {
      facts.push(row);
      keptWordSets.push(rowWords);
      keptChars += sizeOf(row);
    }
  }
  return { facts, collapsed };
}
