import fs from 'node:fs';

const TIME_ZONE = 'Asia/Seoul';
const THEMES = [
  ['body', '몸 상태', /몸|컨디션|피곤|통증|아프|수면|잠|감기|두통|허리|에너지|탈진|회복/i],
  ['location', '위치·이동', /양평|서울|집|교회|위치|이동|도착|출발|머무|올라가|내려가/i],
  ['work', '일·업무', /회사|업무|회의|미팅|고객|프로젝트|마감|야근|출근|퇴근/i],
  ['relationship', '관계', /관계|목사님|성도|가족|친구|대화|만남/i],
  ['emotion', '마음', /마음|감정|불안|기쁨|편안|스트레스|긴장|여유/i],
];
const CORRECTION = /이미|필요\s*없|취소|변경|미뤄|당겨|예정보다|계획과\s*달|안\s*가|가지\s*않|없어/i;

export function loadLifeContext({ path = process.env.WORKLIFE_NOW_CONTEXT_PATH, range } = {}) {
  const rows = readRows(path).map(normalize).filter(Boolean);
  const start = range?.startLocal;
  const end = range?.endLocalExclusive;
  if (!start || !end) return { week: [], recent: [], summary: summarizeLifeContext([]) };

  const recentStart = addDays(start, -28);
  const week = rows.filter((row) => overlaps(row, start, end));
  const recent = rows.filter((row) => row.starts_on >= recentStart && row.starts_on < end);
  return {
    week,
    recent,
    summary: summarizeLifeContext(week),
  };
}

export function summarizeLifeContext(updates = []) {
  const themeCounts = Object.fromEntries(THEMES.map(([key]) => [key, 0]));
  let other = 0;
  let planCorrections = 0;
  const days = new Set();
  for (const update of updates) {
    const text = String(update.text || '');
    const matched = THEMES.filter(([, , pattern]) => pattern.test(text));
    if (!matched.length) other++;
    for (const [key] of matched) themeCounts[key]++;
    if (CORRECTION.test(text)) planCorrections++;
    if (update.starts_on) days.add(update.starts_on);
  }
  if (other) themeCounts.other = other;
  const topThemes = Object.entries(themeCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => ({ key, label: themeLabel(key), count }));
  const count = updates.length;
  const bodySignals = themeCounts.body || 0;
  const workSignals = themeCounts.work || 0;
  const detail = count
    ? `생활 업데이트 ${count}건·${days.size}일, 계획 정정 ${planCorrections}건, 몸 상태 신호 ${bodySignals}건${topThemes.length ? ` · 주요 맥락 ${topThemes.map((item) => item.label).join(', ')}` : ''}`
    : '이번 주에 기록된 생활 업데이트가 없습니다.';
  return {
    present: count > 0,
    count,
    days: days.size,
    planCorrections,
    bodySignals,
    workSignals,
    themeCounts,
    topThemes,
    carriedCount: updates.filter((item) => item.carried_in).length,
    detail,
  };
}

function readRows(path) {
  if (!path || !fs.existsSync(path)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`life context unavailable: ${error.message}`);
    return [];
  }
}

function normalize(row) {
  if (!row?.text) return null;
  const startsOn = validDateKey(row.starts_on) || dateKeyInTimezone(row.created_at);
  if (!startsOn) return null;
  const clearedOn = dateKeyInTimezone(row.cleared_at);
  const expiresOn = validDateKey(row.expires_on) || null;
  return {
    id: String(row.id || ''),
    text: String(row.text).trim().slice(0, 1000),
    source: String(row.source || 'telegram'),
    created_at: row.created_at || null,
    starts_on: startsOn,
    expires_on: expiresOn,
    cleared_on: clearedOn,
    active: row.active !== false,
  };
}

function overlaps(row, start, end) {
  const effectiveEnd = row.cleared_on || row.expires_on;
  const included = row.starts_on < end && (!effectiveEnd || effectiveEnd >= start);
  if (included) row.carried_in = row.starts_on < start;
  return included;
}

function themeLabel(key) {
  return THEMES.find(([theme]) => theme === key)?.[1] || '기타';
}

function validDateKey(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateKeyInTimezone(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
