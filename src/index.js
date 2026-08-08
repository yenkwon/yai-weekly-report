// index.js — orchestrator. `node src/index.js send` | `reconcile` | `publish`
import fs from 'node:fs';
import { loadConfig, buildWeek, withTrends } from './compute.js';
import { lastWeekRange, fetchWeek } from './fetchCalendar.js';
import { analyze } from './weeklyAnalysis.js';
import { synthesizeWeekly } from './weeklySynthesis.js';
import { getAdapter } from './selfReport.js';
import { summaryText, renderHTML, appendHistory, appendPrivateEventHistory } from './renderReportV2.js';
import { sendReport, sendText, readSleepReply } from './telegram.js';
import { applyCorrectionsToConfig, loadCorrections, mergeSleepOverrides } from './corrections.js';
import { loadLifeContext } from './lifeContext.js';

const MODE = process.argv[2] || 'send';
const PAGES = process.env.PAGES_BASE_URL || 'https://yenkwon.github.io/yai-weekly-report';
const PUBLISH_DIR = process.env.PUBLISH_DIR || 'docs';
const PRIVATE_EVENT_HISTORY_PATH = process.env.PRIVATE_EVENT_HISTORY_PATH || '../yai-worklife-agent/store/weekly-event-history.json';
const WORKLIFE_NOW_CONTEXT_PATH = process.env.WORKLIFE_NOW_CONTEXT_PATH || '../yai-worklife-agent/store/now-context.json';
const nextRange = (r) => ({ timeMin:r.timeMax, timeMax:new Date(new Date(r.timeMax).getTime()+7*864e5).toISOString() });

const cfg = loadConfig('./config');
const range = lastWeekRange(cfg.routine.timezone);
const week = range.week;
const lifeContext = loadLifeContext({ path:WORKLIFE_NOW_CONTEXT_PATH, range });
const corrections = loadCorrections(week);
const correctedCfg = applyCorrectionsToConfig(cfg, corrections);
const events = await fetchWeek(cfg.catmap, range);
const nextEvents = await fetchWeek(cfg.catmap, nextRange(range)).catch(()=>[]);
const selfReport = await getAdapter().fetchWeek(range).catch(()=>[]);
const history = fs.existsSync('./data/history.json') ? JSON.parse(fs.readFileSync('./data/history.json','utf8')) : [];
const privateEventHistory = fs.existsSync(PRIVATE_EVENT_HISTORY_PATH) ? JSON.parse(fs.readFileSync(PRIVATE_EVENT_HISTORY_PATH,'utf8')) : [];
const eventsByWeek = new Map(privateEventHistory.map((row) => [row.week, row.events || []]));
const priorHistory = history.filter((row) => row.week !== week).map((row) => ({ ...row, eventHistory:eventsByWeek.get(row.week) || [] }));

async function build(sleepOverride=null, sleepKnown=false) {
  const effectiveSleepOverride = mergeSleepOverrides(corrections.sleepOverride, sleepOverride);
  const sleepOverrideDays = Object.keys(effectiveSleepOverride || {});
  const effectiveSleepKnown = sleepOverrideDays.length === 7;
  const m = withTrends(buildWeek(events, correctedCfg, effectiveSleepOverride, range.startLocal), priorHistory);
  const ins = analyze(m, priorHistory, selfReport, nextEvents, correctedCfg, correctedCfg.catmap, {
    sleepKnown: effectiveSleepKnown,
    lifeContexts: lifeContext.week,
    lifeContextRecent: lifeContext.recent,
  });
  const synthesis = await synthesizeWeekly({
    metrics:m,
    analysis:ins,
    selfReports:selfReport,
    history:priorHistory,
    lifeContexts:lifeContext.week,
    lifeContextRecent:lifeContext.recent,
  });
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
    openingNote: synthesis.openingNote,
    integratedInsight: synthesis.integratedInsight,
    synthesisSource: synthesis.source,
    selfReports: selfReport,
    lifeContexts: lifeContext.week,
    lifeContextRecent: lifeContext.recent,
    ...m,
    ...ins,
    recommendations: [synthesis.experiment],
  };
  fs.mkdirSync(`./${PUBLISH_DIR}/weeks`, { recursive: true });
  const html = renderHTML(report);
  fs.writeFileSync(`./${PUBLISH_DIR}/index.html`, html);
  fs.writeFileSync(`./${PUBLISH_DIR}/weeks/${week}.html`, html);
  appendHistory('./data/history.json', week, m, {
    ...ins.historyRow,
    integratedInsight: synthesis.integratedInsight.title,
  });
  appendPrivateEventHistory(PRIVATE_EVENT_HISTORY_PATH, week, m.eventHistory);
  return { report, link: `${PAGES}/weeks/${week}.html` };
}

if (MODE === 'send') {
  const { report, link } = await build(null, false);
  const msgId = await sendReport(summaryText(report, link));
  fs.writeFileSync('./data/last-msg.json', JSON.stringify({ week, msgId }));
  console.log('sent', { week, note: report.openingNote.source, peak: report.peakDay });
} else if (MODE === 'publish') {
  const { report, link } = await build(null, false);
  console.log('published', { week, note:report.openingNote.source, link });
} else {
  const { msgId } = fs.existsSync('./data/last-msg.json')
    ? JSON.parse(fs.readFileSync('./data/last-msg.json','utf8'))
    : {};
  const sleep = msgId ? await readSleepReply(msgId) : null;
  if (!sleep && !corrections.present) {
    console.log('no sleep reply or corrections');
    process.exit(0);
  }
  const { report, link } = await build(sleep, Boolean(sleep));
  await sendText(`${reconcileLabel({ sleep, corrections })} (${report.weekLabel || report.week})\n평균 수면 ${report.sleepAvg}h\n대시보드 갱신 → ${link}`);
  console.log('reconciled', { sleep, corrections: corrections.present });
}

function reconcileLabel({ sleep, corrections }) {
  if (sleep && corrections.present) return '💤 수면·수정사항 반영 완료 ✅';
  if (sleep) return '💤 수면 반영 완료 ✅';
  return '🛠️ 수정사항 반영 완료 ✅';
}
