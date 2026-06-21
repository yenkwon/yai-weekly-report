// selfReport.js — pluggable adapter for the daily Telegram check-ins.
// The weekly report NEVER knows where logs live. It only calls fetchWeek().
// Daily grain is intentionally minimal: { date:'YYYY-MM-DD', score:1..5, note:'한 줄 원문' }.
// Swap the adapter (env SELF_REPORT_SOURCE) without touching any other code.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TIME_ZONE = process.env.SELF_REPORT_TIMEZONE || 'Asia/Seoul';

const DEFAULT_TELEGRAM_REPORT_PATHS = [
  '../yai-worklife-agent/store/self-reports.json',
  'worklife-agent/store/self-reports.json',
  './store/self-reports.json',
];

// Default: no self-report → report shows objective insights only, subjective sections hide.
export class NullAdapter {
  async fetchWeek(/* {timeMin,timeMax} */) { return []; }
}

// Obsidian daily notes. Convention (recommended): score in frontmatter (`score: 4`),
// the one-line review in the body. Codex fills parsing later.
export class ObsidianAdapter {
  constructor(opts = {}) { this.vaultDir = opts.vaultDir || process.env.OBSIDIAN_DAILY_DIR; }
  async fetchWeek(/* range */) {
    // TODO(codex): read daily .md files in range, parse frontmatter `score`,
    // take first body line as `note`. Return [{date, score, note}].
    return [];
  }
}

// Telegram export / collector DB. Codex fills later.
export class TelegramAdapter {
  constructor(opts = {}) {
    this.paths = opts.paths || [
      process.env.WORKLIFE_SELF_REPORTS_PATH,
      process.env.SELF_REPORTS_PATH,
      ...DEFAULT_TELEGRAM_REPORT_PATHS,
    ].filter(Boolean);
  }

  async fetchWeek(range) {
    const rows = await readFirstJsonArray(this.paths);
    const [startDate, endDate] = weekDateBounds(range);

    return rows
      .map(normalizeTelegramReport)
      .filter(Boolean)
      .filter((row) => row.date >= startDate && row.date < endDate)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

// Mock for local testing of the subjective path.
export class MockAdapter {
  constructor(rows = []) { this.rows = rows; }
  async fetchWeek() { return this.rows; }
}

export function getAdapter() {
  switch ((process.env.SELF_REPORT_SOURCE || 'null').toLowerCase()) {
    case 'obsidian': return new ObsidianAdapter();
    case 'telegram': return new TelegramAdapter();
    default:         return new NullAdapter();
  }
}

async function readFirstJsonArray(paths) {
  for (const path of paths) {
    try {
      const raw = await readFile(resolve(path), 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.reports)) return data.reports;
    } catch {}
  }
  return [];
}

function normalizeTelegramReport(row) {
  if (!row || !row.date) return null;
  const date = String(row.date).slice(0, 10);
  const score = scoreFromRaw(row.raw) ?? toScore(row.score);
  const note = String(row.note || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  return {
    date,
    score,
    note,
    tomorrow_priority: row.tomorrow_priority || '',
    raw: row.raw || '',
  };
}

function toScore(value) {
  if (value == null || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function scoreFromRaw(raw) {
  const match = String(raw || '').trim().match(/^([1-5](?:\.\d+)?)(?=\s*[/|]|$)/);
  return match ? toScore(match[1]) : null;
}

function weekDateBounds(range = {}) {
  const startDate = range.startLocal || range.mondayLocal || dateKeyInTimezone(new Date(range.timeMin || Date.now()));
  const endDate = range.endLocalExclusive || (range.timeMax
    ? dateKeyInTimezone(new Date(range.timeMax))
    : addDays(startDate, 7));
  return [startDate, endDate];
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKeyInTimezone(date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}
