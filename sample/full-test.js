import fs from 'node:fs';
import { loadConfig, buildWeek, withTrends } from '../src/compute.js';
import { analyze } from '../src/weeklyAnalysis.js';
import { synthesizeWeekly } from '../src/weeklySynthesis.js';
import { renderHTML } from '../src/renderReportV2.js';

const cfg = loadConfig('./config');
const events = JSON.parse(fs.readFileSync('./sample/sample-week.json','utf8'));
const nextEvents = JSON.parse(fs.readFileSync('./sample/next-week.json','utf8'));
const history = JSON.parse(fs.readFileSync('./sample/history.sample.json','utf8'));
const mondayISO = '2026-06-08T00:00:00+09:00';

const selfReport = process.argv[2]==='self' ? [
 {date:'2026-06-08',score:4,note:'무난한 시작, 묵상 좋았음'},
 {date:'2026-06-09',score:3,note:'조금 피곤'},
 {date:'2026-06-10',score:3,note:'회의 길었음'},
 {date:'2026-06-11',score:4,note:'목요예배 은혜로웠지만 몸은 지침'},
 {date:'2026-06-12',score:2,note:'대표님 식사 늦게 끝나 방전'},
 {date:'2026-06-13',score:4,note:'사역 풀로 달렸는데 이상하게 뿌듯'},
 {date:'2026-06-14',score:3,note:'주일 끝나고 녹초'},
] : [];

const m = withTrends(buildWeek(events, cfg, null, mondayISO), history);
const ins = analyze(m, history, selfReport, nextEvents, cfg, cfg.catmap, { sleepKnown:false });
const synthesis = await synthesizeWeekly({ metrics:m, analysis:ins, selfReports:selfReport, history });
const note = synthesis.openingNote;
const report = { week:'2026-W25', sleepKnown:false, openingNote:note,
  scenes:synthesis.scenes, dayLines:synthesis.dayLines, themes:synthesis.themes,
  synthesisSource:synthesis.source, selfReports:selfReport, ...m, ...ins, recommendations:[synthesis.experiment] };

console.log('=== OPENING NOTE ('+note.source+') ===\n'+note.text);
console.log('\n=== SCENES ===');
synthesis.scenes.forEach((s)=>console.log(`  [${s.day}] ${s.title}\n      ${s.detail}`));
console.log('\n=== DAY LINES ===');
Object.entries(synthesis.dayLines).forEach(([day,line])=>console.log(`  ${day} (${line.source}, ${line.score??'-'}) ${line.text}`));
console.log('\n=== THEMES ===');
synthesis.themes.forEach((t)=>console.log(`  ${t.name} (${t.recentWeeks}) ${t.detail}`));
console.log('\n=== CHANGES ===');
ins.changesAll.forEach((c)=>console.log(`  ${c.significant?'*':' '} ${c.title} — ${c.detail}`));
console.log('\n=== PREVIEW ===\n  '+ins.preview.title+': '+ins.preview.detail);
console.log('\n=== RECS ===');
ins.recommendations.forEach(r=>console.log(`  (${r.p}) ${r.title}`));
console.log('\n=== SUBJECTIVE present:', ins.subjective.present, '===');

const out = process.argv[2]==='self' ? '주간보고_샘플_대시보드.html' : '주간보고_샘플_객관만.html';
const outputDir = process.env.SAMPLE_OUTPUT_DIR || './sample/output';
fs.mkdirSync(outputDir, { recursive:true });
fs.writeFileSync(`${outputDir}/${out}`, renderHTML(report, { history:[...history, { week:'2026-W25', ...m, ...ins.historyRow }] }));
console.log('\n[ok] wrote', `${outputDir}/${out}`);
