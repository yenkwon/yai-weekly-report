import fs from 'node:fs';
import path from 'node:path';
import { coarsenTimeline, trendSlice } from './publicPayload.js';

const reportLabel = (report) => report.weekLabel || report.week;


// Telegram's legacy Markdown mode fails the whole send on an unbalanced
// control character, and these strings are written by a model or copied from
// event titles.
const md = (value) => String(value ?? '').replace(/([_*`\[])/g, '\\$1');

// The message only has to give a reason to open the page.
const KO = { mon:'월', tue:'화', wed:'수', thu:'목', fri:'금', sat:'토', sun:'일' };

// Telegram's legacy Markdown mode fails the whole send on an unbalanced
// control character, and these strings are written by a model or copied from
// event titles.

// The message only has to give a reason to open the page.
export function summaryText(report, link) {
  const scenes = (report.scenes || []).map((scene) => `• ${KO[scene.day] || ''} — ${md(scene.title)}`);
  const change = (report.changesAll || []).find((item) => item.significant);
  return [
    md(report.openingNote.text),
    '',
    `⚖️ *${md(reportLabel(report))}*`,
    ...(scenes.length ? ['', '*이번 주의 장면*', ...scenes] : []),
    ...(change ? ['', `*달라진 것* ${md(change.title)} — ${md(change.detail)}`] : []),
    '',
    `📊 회고 열기 → ${link}`,
  ].join('\n');
}


export function renderHTML(report, options = {}) {
  const { templatePath = './templates/dashboard-v4.html', history } =
    typeof options === 'string' ? { templatePath: options } : options;
  const template = fs.readFileSync(templatePath, 'utf8');
  return template.replace('/*__WEEK_DATA__*/ null', serializeForScript(publicReport(report, { history })));
}

export function publicReport(report, { history } = {}) {
  const safe = structuredClone(report);
  // Derive before deleting, so the coarsened copy is the only path out.
  const timeline = coarsenTimeline(safe.dayBlocks);
  const trend = trendSlice(history);
  delete safe.selfReports;
  delete safe.lifeContexts;
  delete safe.lifeContextRecent;
  delete safe.lifeBaselines;
  delete safe.rememberedBaselines;
  delete safe.eventHistory;
  delete safe.spotlight;
  delete safe.special;
  delete safe.dayBlocks;
  // historyRow.insightTopics carries raw event titles and nothing renders it —
  // every value it holds is already a top-level field.
  delete safe.historyRow;
  if (timeline) safe.timeline = timeline;
  if (trend.length) safe.trend = trend;
  if (safe.subjective?.gap) {
    delete safe.subjective.gap.note;
    delete safe.subjective.gap.distance;
  }
  if (safe.lifeContext) {
    const { present, count, days, planCorrections, bodySignals, workSignals, themeCounts, topThemes, carriedCount, recentCount, recentDays, recentTopThemes, detail } = safe.lifeContext;
    safe.lifeContext = { present, count, days, planCorrections, bodySignals, workSignals, themeCounts, topThemes, carriedCount, recentCount, recentDays, recentTopThemes, detail };
  }
  if (safe.notableEvents?.items) {
    safe.notableEvents.items = safe.notableEvents.items.map(({ title, category, start, end, durationHours, allDay, periodEvent, day, reasons }) =>
      ({ title, category, start, end, durationHours, allDay, periodEvent, day, reasons }));
  }
  return safe;
}

function serializeForScript(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => ({
    '<':'\\u003c', '>':'\\u003e', '&':'\\u0026', '\u2028':'\\u2028', '\u2029':'\\u2029',
  }[char]));
}

// What a week adds to the public history file. Theme names are kept so next
// week can tell a continuing theme from a new one; the sentences written about
// them live only in that week's page.
export function historyPatch(analysis, synthesis) {
  return { ...analysis.historyRow, themes:(synthesis.themes || []).map((theme) => theme.name) };
}

export function appendHistory(historyPath, week, metrics, patch = {}) {
  const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : [];
  const row = {
    week,
    peakCommitted:metrics.peakCommitted,
    restDays:metrics.restDays,
    sleepAvg:metrics.sleepAvg,
    sleepMin:metrics.sleepMin,
    drivingHours:metrics.drivingHours,
    buckets:metrics.buckets,
    flags:metrics.flags,
    ...patch,
  };
  const index = history.findIndex((item) => item.week === week);
  if (index >= 0) history[index] = row;
  else history.push(row);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  return history;
}

export function appendPrivateEventHistory(historyPath, week, events) {
  const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : [];
  const row = { week, events:events || [] };
  const index = history.findIndex((item) => item.week === week);
  if (index >= 0) history[index] = row;
  else history.push(row);
  fs.mkdirSync(path.dirname(historyPath), { recursive:true });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  return history;
}
