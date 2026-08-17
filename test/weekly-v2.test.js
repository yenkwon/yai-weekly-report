import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, buildWeek, withTrends } from '../src/compute.js';
import { analyze } from '../src/weeklyAnalysis.js';
import { publicReport, appendHistory, appendPrivateEventHistory } from '../src/renderReportV2.js';
import { coarsenTimeline, trendSlice } from '../src/publicPayload.js';
import { loadLifeContext, summarizeLifeContext } from '../src/lifeContext.js';
import { applyLifeBaselines, compactLifeBaselines, loadLifeBaselines } from '../src/lifeBaseline.js';

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
    lifeBaselines:[{raw:'영구 기준 원문'}],
    rememberedBaselines:[{summary:'비공개 기준 요약'}],
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
  assert.equal(safe.lifeBaselines, undefined);
  assert.equal(safe.rememberedBaselines, undefined);
  assert.equal(safe.lifeContext.raw, undefined);
  assert.equal(safe.spotlight, undefined);
  assert.equal(safe.special, undefined);
  assert.equal(safe.subjective.gap.note, undefined);
  assert.equal(safe.notableEvents.items[0].calendar, undefined);
  assert.equal(safe.notableEvents.items[0].title, '선택된 특별 일정');
});

test('published timeline is coarse, gapless, and covers exactly 24h', () => {
  const day = [[0,6.08,'sleep'],[6.08,6.5,'life'],[6.5,7.03,'commute'],[7.03,7.25,'life'],
    [7.25,8,'commute'],[8,17,'work'],[17,17.42,'commute'],[17.42,24,'life']];
  const timeline = coarsenTimeline({ mon:day, tue:day, wed:day, thu:day, fri:day, sat:day, sun:day });
  const blocks = timeline.mon;
  assert.equal(blocks[0][0], 0);
  assert.equal(blocks[blocks.length - 1][1], 24);
  for (const [start, end, type] of blocks) {
    assert.ok(typeof type === 'string');
    assert.equal(Math.round(start * 2), start * 2, `${start} is not on a 30-minute boundary`);
    assert.equal(Math.round(end * 2), end * 2, `${end} is not on a 30-minute boundary`);
  }
  for (let i = 1; i < blocks.length; i += 1) {
    assert.equal(blocks[i][0], blocks[i - 1][1], 'timeline has a gap or overlap');
    assert.notEqual(blocks[i][2], blocks[i - 1][2], 'adjacent same-type blocks were not merged');
  }
  assert.equal(blocks.reduce((sum, [start, end]) => sum + end - start, 0), 24);
  assert.ok(blocks.length <= day.length, 'coarsening must never add blocks');
});

test('a sub-slot block is absorbed rather than published', () => {
  const timeline = coarsenTimeline({ mon:[[0,7,'sleep'],[7,7.17,'life'],[7.17,12,'work'],[12,24,'life']] });
  assert.deepEqual(timeline.mon, [[0,7,'sleep'],[7,12,'work'],[12,24,'life']]);
});

test('trend slice publishes aggregates only and keeps the last 8 weeks', () => {
  const history = Array.from({ length: 11 }, (_, i) => ({
    week: `2026-W${String(i + 20).padStart(2, '0')}`,
    peakCommitted: 10 + i, restDays: 0, sleepAvg: 6.5, avgScore: 4, sleepKnown: i === 10,
    buckets: { work: 40, ministry: 20, worship: 3, life: 42, sleep: 46, commute: 8, career: 1 },
    insightTopics: ['ministry', '모두의 수련회'],
    integratedInsight: '비공개 해석 제목',
    lifeContextThemeCounts: { body: 1 },
  }));
  const trend = trendSlice(history);
  assert.equal(trend.length, 8);
  assert.equal(trend[0].week, '2026-W23');
  assert.equal(trend[7].week, '2026-W30');
  assert.equal(trend[7].sleepKnown, true);
  assert.equal(trend[0].sleepKnown, false);
  assert.doesNotMatch(JSON.stringify(trend), /수련회|비공개 해석 제목/);
  assert.equal(trend[0].insightTopics, undefined);
  assert.equal(trend[0].integratedInsight, undefined);
  assert.equal(trend[0].lifeContextThemeCounts, undefined);
  assert.equal(trend[0].buckets.career, undefined);
  assert.equal(trend[0].buckets.work, 40);
});

test('public payload swaps raw day blocks for the coarsened timeline', () => {
  const safe = publicReport({
    dayBlocks: { mon:[[0,6.08,'sleep'],[6.08,24,'work']], tue:[], wed:[], thu:[], fri:[], sat:[], sun:[] },
    historyRow: { insightTopics:['ministry','전체 원문 일정'], othersPct:88 },
  }, { history: [{ week:'2026-W31', sleepAvg:6.5, buckets:{}, insightTopics:['전체 원문 일정'] }] });
  assert.equal(safe.dayBlocks, undefined);
  assert.equal(safe.historyRow, undefined);
  assert.deepEqual(safe.timeline.mon, [[0,6,'sleep'],[6,24,'work']]);
  assert.equal(safe.trend.length, 1);
  assert.doesNotMatch(JSON.stringify(safe), /전체 원문 일정/);
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

test('confirmed life baseline overrides Sunday ministry and return travel', () => {
  const baselines = [{
    id:'sunday-baseline', active:true, confirmed_at:'2026-06-01T00:00:00.000Z',
    proposal:{kind:'schedule',summary:'주일 사역과 귀가',schedule_blocks:[
      {days:['sun'],title:'주일 사역',start:'08:00',end:'17:00',duration_minutes:540,category:'ministry',location:'양평'},
      {days:['sun'],title:'귀가',start:'17:00',end:'18:30',duration_minutes:90,category:'commute',from:'양평',to:'산본'},
    ]},
  }];
  const applied = applyLifeBaselines(cfg, baselines);
  assert.equal(applied.routine.fixedMinistry.sunChurch.start, '08:00');
  assert.equal(applied.routine.fixedMinistry.sunChurch.end, '17:00');
  assert.equal(applied.routine.fixedMinistry.sunChurch.driveHomeHours, 1.5);
  assert.deepEqual(compactLifeBaselines(baselines), [{id:'sunday-baseline',kind:'schedule',summary:'주일 사역과 귀가'}]);
});

test('life baseline loader keeps active entries private and structured', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-baseline-'));
  const file = path.join(dir, 'life-baseline.json');
  fs.writeFileSync(file, JSON.stringify([{id:'a',active:true,proposal:{summary:'활성'}},{id:'b',active:false,proposal:{summary:'해제'}}]));
  assert.deepEqual(loadLifeBaselines({path:file}).map((item) => item.id), ['a']);
  fs.rmSync(dir, {recursive:true,force:true});
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
