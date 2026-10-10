import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, longestCommonRun, sourceTexts, overlapsSource } from '../src/reflectionGuard.js';

const LONG_NOTE = '반주에 정말 집중을 했고 예배가 좋았다. 내가 아닌 예배에 집중해야 한다는 메시지가 강하게 남았다.';

test('normalizeText drops spacing, punctuation and case', () => {
  assert.equal(normalizeText(' 예배가, 좋았다!  OK '), '예배가좋았다ok');
  assert.equal(normalizeText(null), '');
});

test('longestCommonRun measures the longest shared substring', () => {
  assert.equal(longestCommonRun('abcdef', 'zzcdezz'), 3);
  assert.equal(longestCommonRun('', 'abc'), 0);
});

test('a sentence lifted from a self-report is an overlap', () => {
  const sources = sourceTexts({ selfReports: [{ date: '2026-06-11', note: LONG_NOTE, raw: `4.7/5 | ${LONG_NOTE}` }] });
  assert.equal(overlapsSource('목요일: 내가 아닌 예배에 집중해야 한다는 메시지가 강하게 남았다.', sources), true);
});

test('re-spaced and re-punctuated copies are still an overlap', () => {
  const sources = sourceTexts({ selfReports: [{ note: LONG_NOTE }] });
  assert.equal(overlapsSource('내가아닌 예배에, 집중해야 한다는 메시지가 강하게 남았다', sources), true);
});

test('a rewritten sentence that shares only names or short phrases passes', () => {
  const sources = sourceTexts({ selfReports: [{ note: LONG_NOTE }] });
  assert.equal(overlapsSource('목요일 예배 반주에서 음악보다 예배 자체에 마음을 두게 된 날이었다.', sources), false);
});

test('a short self-report quoted whole is an overlap even under 20 characters', () => {
  const sources = sourceTexts({ selfReports: [{ note: '무난한 시작, 묵상 좋았음' }] });
  assert.equal(overlapsSource('월요일은 무난한 시작, 묵상 좋았음 이라고 적은 날.', sources), true);
  assert.equal(overlapsSource('월요일은 묵상으로 차분하게 연 하루였다.', sources), false);
});

test('life-context text is a source too, and tiny sources are ignored', () => {
  const sources = sourceTexts({
    selfReports: [{ note: '피곤' }],
    lifeContexts: [{ text: '이번 주는 목요일까지 양평에 머물면서 재택으로 일하기로 했다' }],
  });
  assert.equal(sources.length, 1);
  assert.equal(overlapsSource('목요일까지 양평에 머물면서 재택으로 일하기로 했다는 계획대로 흘러갔다.', sources), true);
  assert.equal(overlapsSource('피곤', sources), false);
});

import { loadConfig, buildWeek, withTrends } from '../src/compute.js';
import { analyze } from '../src/weeklyAnalysis.js';

const cfg = loadConfig('./config');
const start = '2026-06-08';
// peakCommitted is deliberately far below any real week so at least one change
// is always significant.
const PRIOR_ROW = { week: '2026-W23', peakCommitted: 3, restDays: 2, sleepAvg: 6, selfPct: 20,
  lateNightCount: 0, loadStdev: 1, avgScore: 3, sleepKnown: false,
  buckets: { ministry: 5, worship: 2, work: 40, life: 30, commute: 5 } };

test('changesAll lists every measured item while changes stays at three', () => {
  const metrics = withTrends(buildWeek([], cfg, null, start), []);
  const reports = [{ date: '2026-06-08', score: 5, note: 'a' }, { date: '2026-06-09', score: 4, note: 'b' }];
  const result = analyze(metrics, [PRIOR_ROW], reports, [], cfg, cfg.catmap, { sleepKnown: false });
  assert.equal(result.changes.length, 3);
  assert.deepEqual(result.changesAll.map((c) => c.key).sort(),
    ['commute', 'felt', 'late', 'life', 'ministry', 'peak', 'rest', 'self', 'sleep', 'spread', 'work']);
  assert.equal(result.changesAll.find((c) => c.key === 'sleep').significant, false);
  assert.equal(result.changesAll.find((c) => c.key === 'sleep').confidence, 'estimate');
  const scores = result.changesAll.map((c) => c.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  for (const change of result.changesAll) assert.ok(change.title && change.detail, change.key);
});

test('changesAll leaves out felt when nothing was self-reported', () => {
  const metrics = withTrends(buildWeek([], cfg, null, start), []);
  const result = analyze(metrics, [PRIOR_ROW], [], [], cfg, cfg.catmap, { sleepKnown: false });
  assert.equal(result.changesAll.some((c) => c.key === 'felt'), false);
});

test('changesAll has no deltas and nothing significant without history', () => {
  const metrics = withTrends(buildWeek([], cfg, null, start), []);
  const result = analyze(metrics, [], [], [], cfg, cfg.catmap, { sleepKnown: false });
  assert.ok(result.changesAll.length >= 10);
  for (const change of result.changesAll) {
    assert.equal(change.weekDelta, null, change.key);
    assert.equal(change.significant, false, change.key);
  }
});

import { calendarDayLine, dayFacts, fallbackDraft, parseDraft, themeRecentWeeks, finalizeReflection, synthesizeWeekly } from '../src/weeklySynthesis.js';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEK_EVENTS = [
  { title: '찬양팀 연습', calendar: 'Ministry Support', allDay: false,
    start: '2026-06-11T19:00:00+09:00', end: '2026-06-11T22:00:00+09:00' },
  { title: '짧은 통화', calendar: 'Ministry Support', allDay: false,
    start: '2026-06-11T12:00:00+09:00', end: '2026-06-11T12:30:00+09:00' },
  { title: '수련회 기간', calendar: 'Ministry Support', allDay: true, start: '2026-06-13', end: '2026-06-14' },
];
const weekOf = (events, reports = [], history = []) => {
  const metrics = withTrends(buildWeek(events, cfg, null, start), history);
  const analysis = analyze(metrics, history, reports, [], cfg, cfg.catmap, { sleepKnown: false });
  return { metrics, analysis };
};
const draftOf = (overrides = {}) => ({
  openingNote: '사역이 길었지만 마음은 가벼웠던 한 주.',
  scenes: [{ day: 'thu', title: '예배에 붙들린 저녁', detail: '반주 중에 음악이 아니라 예배로 마음이 돌아온 순간이 있었다.' }],
  dayLines: Object.fromEntries(DAYS.map((day) => [day, `${day} 하루를 새로 쓴 문장`])),
  themes: [{ name: '예배와 음악 사이', detail: '잘 치는 것과 예배하는 것의 차이를 여러 번 적었다.' }],
  experiment: { title: '빈 저녁 하루 지키기', detail: '수요일 저녁을 비워 두고 목요일 체감을 본다.' },
  ...overrides,
});

test('calendarDayLine names the longest timed event, a banner, or the routine', () => {
  const { metrics } = weekOf(WEEK_EVENTS);
  assert.match(calendarDayLine('thu', metrics), /^'찬양팀 연습' 중심의 하루 · 구속 시간 [\d.]+h$/);
  assert.match(calendarDayLine('sat', metrics), /^'수련회 기간' 일정이 걸쳐 있던 날 · 구속 시간 [\d.]+h$/);
  assert.match(calendarDayLine('mon', metrics), /^등록된 일정 없이 평소 루틴으로 보낸 날 · 구속 시간 [\d.]+h$/);
});

test('fallbackDraft fills all seven days and stays empty where it has nothing', () => {
  const { metrics, analysis } = weekOf([]);
  const draft = fallbackDraft(metrics, analysis);
  assert.deepEqual(Object.keys(draft.dayLines), DAYS);
  for (const day of DAYS) assert.ok(draft.dayLines[day].length > 0, day);
  assert.deepEqual(draft.themes, []);
  assert.ok(Array.isArray(draft.scenes));
  assert.ok(draft.openingNote && draft.experiment.title && draft.experiment.detail);
});

test('dayFacts marks which days have a report and uses the last one for the score', () => {
  const { metrics } = weekOf(WEEK_EVENTS);
  const facts = dayFacts(metrics, [
    { date: '2026-06-11', score: 2, note: '오전' }, { date: '2026-06-11', score: 4, note: '저녁' },
    { date: '2026-05-01', score: 1, note: '범위 밖' },
  ]);
  assert.equal(facts.thu.has_report, true);
  assert.equal(facts.thu.score, 4);
  assert.deepEqual(facts.thu.events, ['찬양팀 연습', '짧은 통화']);
  assert.equal(facts.mon.has_report, false);
  assert.equal(facts.mon.score, null);
});

test('parseDraft accepts fenced JSON and trims oversized lists', () => {
  const body = {
    opening_note: ' 한 주 ',
    scenes: [1, 2, 3, 4, 5].map((n) => ({ day: 'mon', title: `장면${n}`, detail: '내용' })),
    day_lines: Object.fromEntries(DAYS.map((day) => [day, '문장'])),
    themes: [1, 2, 3, 4, 5].map((n) => ({ name: `주제${n}`, detail: '내용' })),
    experiment: { title: '실험', detail: '기준' },
  };
  const draft = parseDraft('```json\n' + JSON.stringify(body) + '\n```');
  assert.equal(draft.openingNote, '한 주');
  assert.equal(draft.scenes.length, 3);
  assert.equal(draft.themes.length, 4);
});

test('parseDraft rejects a missing day and an unknown scene day', () => {
  const good = {
    opening_note: '한 주', scenes: [], themes: [],
    day_lines: Object.fromEntries(DAYS.map((day) => [day, '문장'])),
    experiment: { title: '실험', detail: '기준' },
  };
  const sixDays = structuredClone(good); delete sixDays.day_lines.sun;
  const badDay = structuredClone(good); badDay.scenes = [{ day: 'someday', title: 'x', detail: 'y' }];
  assert.throws(() => parseDraft(JSON.stringify(sixDays)));
  assert.throws(() => parseDraft(JSON.stringify(badDay)));
  assert.doesNotThrow(() => parseDraft(JSON.stringify(good)));
});

test('themeRecentWeeks counts this week plus matching weeks among the last four', () => {
  const history = [
    { week: 'W20', themes: ['예배와 음악 사이'] },
    { week: 'W21', themes: ['예배와 음악 사이'] },
    { week: 'W22' },
    { week: 'W23', themes: ['PM 준비'] },
    { week: 'W24', themes: ['예배와  음악 사이!'] },
  ];
  assert.equal(themeRecentWeeks('예배와 음악 사이', history), 3);
  assert.equal(themeRecentWeeks('처음 나온 주제', history), 1);
  assert.equal(themeRecentWeeks('예배와 음악 사이', []), 1);
});

test('finalizeReflection keeps a clean draft and labels each day by whether it was reported', () => {
  const reports = [
    { date: '2026-06-10', score: 3, note: '회의가 길어서 정리할 틈이 없던 하루였음' },
    { date: '2026-06-11', score: 4.7, note: '반주에 깊이 집중한 저녁이었고 끝나고 나서도 마음이 가벼웠음' },
  ];
  const { metrics, analysis } = weekOf(WEEK_EVENTS, reports);
  const result = finalizeReflection({ draft: draftOf(), source: 'llm', metrics, analysis, selfReports: reports, history: [] });
  assert.equal(result.source, 'llm');
  assert.equal(result.openingNote.source, 'llm');
  assert.equal(result.scenes.length, 1);
  assert.deepEqual(result.dayLines.thu, { text: 'thu 하루를 새로 쓴 문장', source: 'report', score: 4.7 });
  assert.deepEqual(result.dayLines.mon, { text: 'mon 하루를 새로 쓴 문장', source: 'calendar', score: null });
  assert.deepEqual(result.themes, [{ name: '예배와 음악 사이', detail: '잘 치는 것과 예배하는 것의 차이를 여러 번 적었다.', recentWeeks: 1 }]);
  assert.equal(result.experiment.p, 1);
  assert.equal(result.experiment.source, 'llm');
  assert.deepEqual(result.guard, { opening: false, scenes: 0, dayLines: [], themes: 0, experiment: false });
});

test('finalizeReflection replaces only what copied a private original', () => {
  const copied = '반주에 깊이 집중한 저녁이었고 끝나고 나서도 마음이 가벼웠음';
  const reports = [
    { date: '2026-06-10', score: 3, note: '회의가 길어서 정리할 틈이 없던 하루였음' },
    { date: '2026-06-11', score: 4.7, note: copied },
  ];
  const { metrics, analysis } = weekOf(WEEK_EVENTS, reports);
  const draft = draftOf({
    scenes: [
      { day: 'thu', title: '예배에 붙들린 저녁', detail: `그날 적은 말: ${copied}.` },
      { day: 'wed', title: '긴 회의', detail: '회의가 길게 이어져 숨 돌릴 틈이 없었다.' },
    ],
    themes: [
      { name: '예배와 음악 사이', detail: copied },
      { name: '일의 속도', detail: '회의가 하루를 다 가져간 날이 있었다.' },
    ],
  });
  draft.dayLines.thu = `목요일: ${copied}`;
  const result = finalizeReflection({ draft, source: 'llm', metrics, analysis, selfReports: reports, history: [] });
  assert.deepEqual(result.scenes.map((scene) => scene.title), ['긴 회의']);
  assert.deepEqual(result.themes.map((theme) => theme.name), ['일의 속도']);
  assert.equal(result.dayLines.thu.text, calendarDayLine('thu', metrics));
  assert.equal(result.dayLines.thu.source, 'report');
  assert.equal(result.dayLines.wed.text, 'wed 하루를 새로 쓴 문장');
  assert.deepEqual(result.guard, { opening: false, scenes: 1, dayLines: ['thu'], themes: 1, experiment: false });
  assert.equal(JSON.stringify(result).includes(copied), false);
});

test('finalizeReflection swaps a copied opening and experiment for the computed ones', () => {
  const copied = '반주에 깊이 집중한 저녁이었고 끝나고 나서도 마음이 가벼웠음';
  const reports = [{ date: '2026-06-11', score: 4, note: copied }];
  const { metrics, analysis } = weekOf(WEEK_EVENTS, reports);
  const draft = draftOf({ openingNote: copied, experiment: { title: '다음 주에도', detail: copied } });
  const result = finalizeReflection({ draft, source: 'llm', metrics, analysis, selfReports: reports, history: [] });
  assert.equal(result.openingNote.source, 'fallback');
  assert.equal(result.openingNote.text, fallbackDraft(metrics, analysis).openingNote);
  assert.equal(result.experiment.title, analysis.experimentCandidate.title);
  assert.equal(result.experiment.source, 'fallback');
  assert.equal(result.guard.opening, true);
  assert.equal(result.guard.experiment, true);
});

test('themes need self-reports on at least two different days and are de-duplicated', () => {
  const sameDay = [{ date: '2026-06-11', score: 3, note: '오전 기록' }, { date: '2026-06-11', score: 4, note: '저녁 기록' }];
  const one = weekOf(WEEK_EVENTS, sameDay);
  const none = finalizeReflection({ draft: draftOf(), source: 'llm', ...one, selfReports: sameDay, history: [] });
  assert.deepEqual(none.themes, []);

  const twoDays = [{ date: '2026-06-10', score: 3, note: '수요일 기록' }, { date: '2026-06-11', score: 4, note: '목요일 기록' }];
  const two = weekOf(WEEK_EVENTS, twoDays);
  const draft = draftOf({ themes: [
    { name: '예배와 음악 사이', detail: '첫 번째' }, { name: '예배와 음악 사이 ', detail: '중복' },
  ] });
  const kept = finalizeReflection({ draft, source: 'llm', ...two, selfReports: twoDays,
    history: [{ week: 'W23', themes: ['예배와 음악 사이'] }] });
  assert.deepEqual(kept.themes, [{ name: '예배와 음악 사이', detail: '첫 번째', recentWeeks: 2 }]);
});

test('synthesizeWeekly without an API key returns the computed reflection for an empty week', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { metrics, analysis } = weekOf([]);
    const result = await synthesizeWeekly({ metrics, analysis, selfReports: [], history: [] });
    assert.equal(result.source, 'fallback');
    assert.deepEqual(Object.keys(result.dayLines), DAYS);
    for (const day of DAYS) assert.equal(result.dayLines[day].source, 'calendar');
    assert.deepEqual(result.themes, []);
    assert.equal(result.integratedInsight, undefined);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});
