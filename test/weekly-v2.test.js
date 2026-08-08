import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, buildWeek, withTrends } from '../src/compute.js';
import { analyze } from '../src/weeklyAnalysis.js';
import { publicReport, appendHistory, appendPrivateEventHistory } from '../src/renderReportV2.js';
import { loadLifeContext, summarizeLifeContext } from '../src/lifeContext.js';

const cfg = loadConfig('./config');
const start = '2026-06-08';

test('cross-midnight events are split by local-day overlap', () => {
  const metrics = buildWeek([{
    title:'야간 사역', calendar:'Ministry Support', allDay:false,
    start:'2026-06-08T23:00:00+09:00', end:'2026-06-09T02:00:00+09:00',
  }], cfg, null, start);
  assert.equal(metrics.ministryByDay.mon, 1);
  assert.equal(metrics.ministryByDay.tue, 2);
});

test('all-day banners do not become committed hours', () => {
  const metrics = buildWeek([{
    title:'수련회 기간', calendar:'Ministry Support', allDay:true,
    start:'2026-06-11', end:'2026-06-14',
  }], cfg, null, start);
  assert.equal(metrics.eventHistory[0].durationHours, null);
  assert.equal(metrics.ministryByDay.fri, 0);
});

test('estimated sleep never accumulates recovery debt', () => {
  const metrics = withTrends(buildWeek([], cfg, null, start), []);
  const history = [{ week:'2026-W23', recoveryBalance:-35.6, sleepKnown:false, buckets:{} }];
  const result = analyze(metrics, history, [], [], cfg, cfg.catmap, { sleepKnown:false });
  const recovery = result.lenses.find((lens) => lens.key === 'recovery_debt');
  assert.equal(recovery.balance, null);
  assert.equal(result.historyRow.recoveryBalance, null);
});

test('multi-day preview never reports the full 51 hours on one day', () => {
  const metrics = withTrends(buildWeek([], cfg, null, start), []);
  const result = analyze(metrics, [], [], [{
    title:'긴 사역 일정', calendar:'Ministry Support', allDay:false,
    start:'2026-06-18T18:00:00+09:00', end:'2026-06-20T21:00:00+09:00',
  }], cfg, cfg.catmap, { sleepKnown:false });
  assert.equal(Math.max(...Object.values(result.preview.dayHours)), 0);
  assert.deepEqual(result.preview.banners, ['긴 사역 일정']);
  assert.doesNotMatch(result.preview.detail, /51h/);
});

test('a 24h+ timed period is context, not committed active time', () => {
  const metrics = buildWeek([{
    title:'수련회 기간', calendar:'Ministry Support', allDay:false,
    start:'2026-06-11T18:00:00+09:00', end:'2026-06-13T21:00:00+09:00',
  }], cfg, null, start);
  assert.equal(metrics.eventHistory[0].periodEvent, true);
  assert.equal(metrics.eventHistory[0].durationHours, null);
  assert.ok(metrics.peakCommitted <= 24);
});

test('ministry overlapping routine work is counted once', () => {
  const metrics = buildWeek([{
    title:'청소년 수련회', calendar:'Ministry Support', allDay:false,
    start:'2026-06-09T08:00:00+09:00', end:'2026-06-09T22:30:00+09:00',
  }], cfg, null, start);
  assert.equal(metrics.ministryByDay.tue, 14.5);
  assert.equal(metrics.committedByDay.tue, 14.67);
  assert.ok(metrics.peakCommitted <= 24);
});

test('public payload excludes raw reports and full event history', () => {
  const safe = publicReport({
    selfReports:[{date:'2026-06-08',note:'민감한 자기보고'}],
    eventHistory:[{title:'전체 원문 일정'}],
    lifeContexts:[{text:'이미 양평에 와 있음'}],
    lifeContextRecent:[{text:'몸 상태가 좋지 않음'}],
    lifeContext:{present:true,count:2,days:1,planCorrections:1,bodySignals:1,workSignals:0,themeCounts:{location:1,body:1},topThemes:[],carriedCount:0,detail:'안전한 집계',raw:'노출 금지'},
    spotlight:{rows:[{label:'전체 원문 일정'}]},
    special:[{title:'전체 원문 일정'}],
    subjective:{gap:{text:'요약',note:'민감한 자기보고',distance:2}},
    notableEvents:{items:[{title:'선택된 특별 일정',calendar:'Private',reasons:['새 일정']}]},
  });
  assert.equal(safe.selfReports, undefined);
  assert.equal(safe.eventHistory, undefined);
  assert.equal(safe.lifeContexts, undefined);
  assert.equal(safe.lifeContextRecent, undefined);
  assert.equal(safe.lifeContext.raw, undefined);
  assert.equal(safe.spotlight, undefined);
  assert.equal(safe.special, undefined);
  assert.equal(safe.subjective.gap.note, undefined);
  assert.equal(safe.notableEvents.items[0].calendar, undefined);
  assert.equal(safe.notableEvents.items[0].title, '선택된 특별 일정');
});

test('life context loader selects the week and summarizes private updates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-context-'));
  const file = path.join(dir, 'now-context.json');
  fs.writeFileSync(file, JSON.stringify([
    {id:'a',text:'이미 양평에 와 있어서 내일 이동 계획은 필요 없음',starts_on:'2026-06-09',expires_on:'2026-06-11'},
    {id:'b',text:'몸이 많이 피곤하고 회사 마감 이슈가 큼',starts_on:'2026-06-10',expires_on:'2026-06-12'},
    {id:'c',text:'다음 달 정보',starts_on:'2026-07-01',expires_on:'2026-07-02'},
  ]));
  const loaded = loadLifeContext({path:file,range:{startLocal:'2026-06-08',endLocalExclusive:'2026-06-15'}});
  assert.equal(loaded.week.length, 2);
  assert.equal(loaded.summary.count, 2);
  assert.equal(loaded.summary.planCorrections, 1);
  assert.equal(loaded.summary.bodySignals, 1);
  assert.equal(loaded.summary.workSignals, 1);
  fs.rmSync(dir, {recursive:true,force:true});
});

test('weekly analysis persists only aggregate life-context history', () => {
  const metrics = withTrends(buildWeek([], cfg, null, start), []);
  const updates = [
    {text:'이미 현지에 와 있어서 이동할 필요 없음',starts_on:'2026-06-09'},
    {text:'몸이 피곤함',starts_on:'2026-06-10'},
  ];
  const result = analyze(metrics, [{week:'2026-W23',lifeContextCount:0,buckets:{}}], [], [], cfg, cfg.catmap, {sleepKnown:false,lifeContexts:updates,lifeContextRecent:[...updates,{text:'지난주 마음이 불안함',starts_on:'2026-06-02'}]});
  assert.equal(result.lifeContext.count, 2);
  assert.equal(result.historyRow.lifeContextCount, 2);
  assert.equal(result.historyRow.lifeContextPlanCorrections, 1);
  assert.equal(result.lifeContext.recentCount, 3);
  assert.equal(result.historyRow.text, undefined);
  assert.equal(summarizeLifeContext(updates).bodySignals, 1);
});

test('a routine is notable only in the week it starts', () => {
  const localCfg = structuredClone(cfg);
  localCfg.nonCalendarRoutines = [{
    id:'new-briefing', title:'새 브리핑', report_title:'새 브리핑', category:'ministry',
    days:['mon','tue','wed','thu','fri','sat'], active_from:'2026-06-10', duration_minutes:10,
  }];
  const metrics = withTrends(buildWeek([], localCfg, null, start), []);
  const result = analyze(metrics, [], [], [], localCfg, localCfg.catmap, { sleepKnown:false });
  const item = result.notableEvents.items.find((event) => event.title === '새 브리핑');
  assert.ok(item);
  assert.deepEqual(item.reasons, ['이번 주 시작한 캘린더 밖 루틴']);
});

test('raw event titles are written only to the private history file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-history-'));
  const publicPath = path.join(dir, 'public.json');
  const privatePath = path.join(dir, 'private', 'events.json');
  const metrics = buildWeek([{title:'원문 일정',calendar:'Ministry Support',allDay:false,
    start:'2026-06-08T20:00:00+09:00',end:'2026-06-08T21:00:00+09:00'}], cfg, null, start);
  appendHistory(publicPath, '2026-W24', metrics, {});
  appendPrivateEventHistory(privatePath, '2026-W24', metrics.eventHistory);
  assert.doesNotMatch(fs.readFileSync(publicPath,'utf8'), /원문 일정/);
  assert.match(fs.readFileSync(privatePath,'utf8'), /원문 일정/);
  fs.rmSync(dir, { recursive:true, force:true });
});
