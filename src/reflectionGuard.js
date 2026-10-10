// Keeps private originals out of the public page.
//
// The weekly page may say anything about the week, but it must say it in new
// words: self-report and life-context originals never leave the private store.
// These helpers decide whether a generated sentence copied its source.

export const OVERLAP_LIMIT = 20;
export const SHORT_SOURCE_MIN = 8;

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function longestCommonRun(a, b) {
  const x = [...a];
  const y = [...b];
  if (!x.length || !y.length) return 0;
  let previous = new Array(y.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= x.length; i += 1) {
    const current = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j += 1) {
      if (x[i - 1] !== y[j - 1]) continue;
      current[j] = previous[j - 1] + 1;
      if (current[j] > best) best = current[j];
    }
    previous = current;
  }
  return best;
}

export function sourceTexts({ selfReports = [], lifeContexts = [], lifeContextRecent = [] } = {}) {
  const originals = [];
  for (const report of selfReports || []) originals.push(report?.note, report?.raw, report?.tomorrow_priority);
  for (const row of [...(lifeContexts || []), ...(lifeContextRecent || [])]) originals.push(row?.text, row?.raw);
  return [...new Set(originals.map(normalizeText).filter((text) => text.length >= SHORT_SOURCE_MIN))];
}

export function overlapsSource(text, sources) {
  const candidate = normalizeText(text);
  if (!candidate) return false;
  return (sources || []).some((source) => (
    source.length < OVERLAP_LIMIT
      ? candidate.includes(source)
      : longestCommonRun(candidate, source) >= OVERLAP_LIMIT
  ));
}
