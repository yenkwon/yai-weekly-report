// Shaping helpers for the public dashboard payload.
//
// Everything here is a pure function so the privacy rules that decide what
// leaves the private analysis and lands on GitHub Pages are testable instead of
// eyeballed. `renderReportV2.publicReport` is the only caller.

const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];

// compute.js paints dayBlocks on a 5-minute grid; keep the same unit here so a
// resample is exact rather than approximate.
const SLOTS_PER_HOUR = 12;
const DAY_SLOTS = 24 * SLOTS_PER_HOUR;

const TREND_KEYS = [
  'week','peakCommitted','restDays','sleepAvg','sleepMin',
  'othersPct','selfPct','lateNightCount','loadStdev','avgScore',
];
const TREND_BUCKETS = ['work','ministry','worship','life','sleep','commute'];

/**
 * Coarsen the private minute-level day blocks into a publishable timeline.
 *
 * Rounding boundaries and then merging can open gaps, so instead each coarse
 * slot takes the majority type of the 5-minute slots it covers. That keeps the
 * invariant the dashboard relies on: every day is exactly 24h, no gaps, no
 * overlaps — while dropping the sub-slot precision that would expose an exact
 * daily timetable.
 */
export function coarsenTimeline(dayBlocks, slotHours = 0.5) {
  if (!dayBlocks) return null;
  const span = Math.max(1, Math.round(slotHours * SLOTS_PER_HOUR));
  const timeline = {};
  for (const day of DAYS) {
    const blocks = dayBlocks[day];
    if (!Array.isArray(blocks) || !blocks.length) { timeline[day] = []; continue; }

    const paint = new Array(DAY_SLOTS).fill(null);
    for (const [start, end, type] of blocks) {
      const from = Math.max(0, Math.round(start * SLOTS_PER_HOUR));
      const to = Math.min(DAY_SLOTS, Math.round(end * SLOTS_PER_HOUR));
      for (let i = from; i < to; i += 1) paint[i] = type;
    }
    const filler = blocks[0][2];
    for (let i = 0; i < DAY_SLOTS; i += 1) if (paint[i] == null) paint[i] = filler;

    const merged = [];
    for (let i = 0; i < DAY_SLOTS; i += span) {
      const counts = new Map();
      for (let j = i; j < i + span && j < DAY_SLOTS; j += 1) {
        counts.set(paint[j], (counts.get(paint[j]) || 0) + 1);
      }
      // Map keeps insertion order, so a tie resolves to the type that starts
      // earliest in the window — deterministic across runs.
      let winner = paint[i];
      let best = 0;
      for (const [type, count] of counts) if (count > best) { winner = type; best = count; }

      const start = +(i / SLOTS_PER_HOUR).toFixed(2);
      const end = +(Math.min(i + span, DAY_SLOTS) / SLOTS_PER_HOUR).toFixed(2);
      const last = merged[merged.length - 1];
      if (last && last[2] === winner) last[1] = end;
      else merged.push([start, end, winner]);
    }
    timeline[day] = merged;
  }
  return timeline;
}

/**
 * Last `limit` weeks of aggregates, oldest first, whitelisted key by key.
 *
 * history.json rows also carry `insightTopics` (raw event titles) and
 * `integratedInsight`, so this copies allowed keys across rather than deleting
 * the disallowed ones — a new field added upstream stays private by default.
 */
export function trendSlice(history, limit = 8) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((row) => row && row.week)
    .slice()
    .sort((a, b) => String(a.week).localeCompare(String(b.week)))
    .slice(-limit)
    .map((row) => {
      const out = {};
      for (const key of TREND_KEYS) if (row[key] !== undefined) out[key] = row[key];
      out.sleepKnown = row.sleepKnown === true;
      out.buckets = Object.fromEntries(TREND_BUCKETS.map((key) => [key, row.buckets?.[key] ?? 0]));
      return out;
    });
}
