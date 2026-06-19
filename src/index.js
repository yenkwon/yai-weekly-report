// index.js — orchestrator. `node src/index.js send` | `reconcile`
import fs from 'node:fs';
import { loadConfig, buildWeek, withTrends } from './compute.js';
import { lastWeekRange, fetchWeek } from './fetchCalendar.js';
import { analyze } from './insights.js';
import { openingNote } from './openingNote.js';
import { getAdapter } from './selfReport.js';
import { summaryText, renderHTML, appendHistory } from './renderReport.js';
import { sendReport, sendText, readSleepReply } from './telegram.js';

const MODE = process.argv[2] || 'send';
const PAGES = process.env.PAGES_BASE_URL || 'https://USER.github.io/yenny-balance-report';
const isoWeek = (d=new Date()) => { const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const day=(t.getUTCDay()+6)%7; t.setUTCDate(t.getUTCDate()-day+3); const y=t.getUTCFullYear();
  const w=Math.ceil(((t-new Date(Date.UTC(y,0,4)))/864e5+1)/7); return `${y}-W${String(w).padStart(2,'0')}`; };
const nextRange = (r) => ({ timeMin:r.timeMax, timeMax:new Date(new Date(r.timeMax).getTime()+7*864e5).toISOString() });

const cfg = loadConfig('./config');
const week = isoWeek();
const range = lastWeekRange(cfg.routine.timezone);
const events = await fetchWeek(cfg.catmap, range);
const nextEvents = await fetchWeek(cfg.catmap, nextRange(range)).catch(()=>[]);
const selfReport = await getAdapter().fetchWeek(range).catch(()=>[]);
const history = fs.existsSync('./data/history.json') ? JSON.parse(fs.readFileSync('./data/history.json','utf8')) : [];

async function build(sleepOverride=null, sleepKnown=false) {
  const m = withTrends(buildWeek(events, cfg, sleepOverride, range.mondayLocal), history);
  const ins = analyze(m, history, selfReport, nextEvents, cfg, cfg.catmap);
  const note = await openingNote(m, ins, selfReport);
  const report = { week, sleepKnown, openingNote: note, selfReports: selfReport, ...m, ...ins };
  fs.mkdirSync('./public/weeks', { recursive: true });
  const html = renderHTML(report);
  fs.writeFileSync('./public/index.html', html);
  fs.writeFileSync(`./public/weeks/${week}.html`, html);
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
