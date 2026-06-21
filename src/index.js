// index.js — orchestrator. `node src/index.js send` | `reconcile`
import fs from 'node:fs';
import { loadConfig, buildWeek, withTrends } from './compute.js';
import { lastWeekRange, fetchWeek } from './fetchCalendar.js';
import { analyze } from './insights.js';
import { openingNote } from './openingNote.js';
import { getAdapter } from './selfReport.js';
import { summaryText, renderHTML, appendHistory } from './renderReport.js';
import { sendReport, sendText, readSleepReply } from './telegram.js';
import { applyCorrectionsToConfig, loadCorrections, mergeSleepOverrides } from './corrections.js';

const MODE = process.argv[2] || 'send';
const PAGES = process.env.PAGES_BASE_URL || 'https://yenkwon.github.io/yai-weekly-report';
const PUBLISH_DIR = process.env.PUBLISH_DIR || 'docs';
const nextRange = (r) => ({ timeMin:r.timeMax, timeMax:new Date(new Date(r.timeMax).getTime()+7*864e5).toISOString() });

const cfg = loadConfig('./config');
const range = lastWeekRange(cfg.routine.timezone);
const week = range.week;
const corrections = loadCorrections(week);
const correctedCfg = applyCorrectionsToConfig(cfg, corrections);
const events = await fetchWeek(cfg.catmap, range);
const nextEvents = await fetchWeek(cfg.catmap, nextRange(range)).catch(()=>[]);
const selfReport = await getAdapter().fetchWeek(range).catch(()=>[]);
const history = fs.existsSync('./data/history.json') ? JSON.parse(fs.readFileSync('./data/history.json','utf8')) : [];
const priorHistory = history.filter((row) => row.week !== week);

async function build(sleepOverride=null, sleepKnown=false) {
  const effectiveSleepOverride = mergeSleepOverrides(corrections.sleepOverride, sleepOverride);
  const sleepOverrideDays = Object.keys(effectiveSleepOverride || {});
  const effectiveSleepKnown = sleepOverrideDays.length === 7;
  const m = withTrends(buildWeek(events, correctedCfg, effectiveSleepOverride, range.startLocal), priorHistory);
  const ins = analyze(m, priorHistory, selfReport, nextEvents, correctedCfg, correctedCfg.catmap);
  const note = await openingNote(m, ins, selfReport);
  const report = {
    week,
    weekLabel: range.weekLabel,
    period: {
      startLocal: range.startLocal,
      endLocalInclusive: range.endLocalInclusive,
      endLocalExclusive: range.endLocalExclusive,
    },
    sleepKnown: effectiveSleepKnown,
    sleepOverrideDays,
    sleepSource: sleepOverrideDays.length ? (sleepKnown ? 'reply' : 'correction') : 'estimate',
    corrections,
    openingNote: note,
    selfReports: selfReport,
    ...m,
    ...ins,
  };
  fs.mkdirSync(`./${PUBLISH_DIR}/weeks`, { recursive: true });
  const html = renderHTML(report);
  fs.writeFileSync(`./${PUBLISH_DIR}/index.html`, html);
  fs.writeFileSync(`./${PUBLISH_DIR}/weeks/${week}.html`, html);
  appendHistory('./data/history.json', week, m, ins.historyRow);
  return { report, link: `${PAGES}/weeks/${week}.html` };
}

if (MODE === 'send') {
  const { report, link } = await build(null, false);
  const msgId = await sendReport(summaryText(report, link));
  fs.writeFileSync('./data/last-msg.json', JSON.stringify({ week, msgId }));
  console.log('sent', { week, note: report.openingNote.source, peak: report.peakDay });
} else {
  const { msgId } = JSON.parse(fs.readFileSync('./data/last-msg.json','utf8'));
  const sleep = await readSleepReply(msgId);
  if (!sleep) { console.log('no sleep reply'); process.exit(0); }
  const { report, link } = await build(sleep, true);
  await sendText(`💤 수면 반영 완료 ✅ (평균 ${report.sleepAvg}h)\n📊 갱신 → ${link}`);
  console.log('reconciled', sleep);
}
