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
