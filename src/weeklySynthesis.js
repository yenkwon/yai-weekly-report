// One Claude call writes the week's record: scenes, a line per day, themes.
// Code owns the numbers, the fallback, and the check that nothing private was
// copied out verbatim.
import { sourceTexts, overlapsSource, normalizeText } from './reflectionGuard.js';

const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];

const SYSTEM = `너는 예은의 주간 회고 페이지를 쓰는 기록 파트너다.
이 페이지의 목적은 한 주에 무슨 일이 있었고 어땠는지를 나중에 다시 읽을 수 있게 남기는 것이다. 해석보다 기록을 우선한다.
입력의 숫자는 이미 코드가 계산했다. 숫자를 다시 계산하거나 추측하지 않는다.
자기보고와 생활 업데이트의 내용은 사람, 업무, 갈등, 건강을 포함해 구체적으로 써도 된다. 다만 원문 문장을 그대로 옮기지 말고 반드시 새 문장으로 다시 쓴다.
생활 업데이트는 캘린더에 없는 최신 실제 상태다. 캘린더와 충돌하면 더 최근의 생활 업데이트를 우선한다.
사역은 짐이 아니라 소명이라는 관점을 존중한다. 진단, 자책 유도, 뻔한 위로, 매주 반복되는 이동시간 조언은 쓰지 않는다. 수면이 추정치면 회복 정도를 단정하지 않는다.
scenes: 그 주를 대표하는 장면 2~3개. day는 mon, tue, wed, thu, fri, sat, sun 중 하나다.
day_lines: 일곱 요일 모두 한 문장씩. day_facts에서 has_report가 true인 날은 그날 자기보고를 바탕으로 쓰고, false인 날은 그날 일정만으로 쓴다. 기록이 없는 날의 기분이나 사건을 지어내지 않는다.
themes: 자기보고에서 반복된 생각, 고민, 배운 것 최대 4개. 자기보고가 2일 미만이면 빈 배열로 둔다. recent_themes에 있는 주제가 이어지면 그 이름을 글자 그대로 다시 쓰고, 새 주제에만 새 이름을 붙인다.
experiment: candidate_experiment를 참고해 다음 주에 해 볼 행동 하나.
반드시 JSON 하나만 출력한다: {"opening_note":"1~2문장","scenes":[{"day":"fri","title":"짧은 제목","detail":"2~3문장"}],"day_lines":{"mon":"한 문장","tue":"한 문장","wed":"한 문장","thu":"한 문장","fri":"한 문장","sat":"한 문장","sun":"한 문장"},"themes":[{"name":"짧은 이름","detail":"1~2문장"}],"experiment":{"title":"행동 하나","detail":"검증할 관찰 기준을 포함한 1~2문장"}}`;

export async function synthesizeWeekly({ metrics, analysis, selfReports = [], history = [], lifeContexts = [], lifeContextRecent = [], rememberedBaselines = [] }) {
  const finalize = (draft, source) => finalizeReflection({ draft, source, metrics, analysis, selfReports, history, lifeContexts, lifeContextRecent });
  const fallback = () => finalize(fallbackDraft(metrics, analysis), 'fallback');
  if (!process.env.ANTHROPIC_API_KEY) return fallback();
  try {
    const facts = buildFacts(metrics, analysis, selfReports, history, lifeContexts, lifeContextRecent, rememberedBaselines);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-api-key':process.env.ANTHROPIC_API_KEY,
        'anthropic-version':'2023-06-01',
      },
      body:JSON.stringify({
        model:process.env.WEEKLY_MODEL || process.env.NOTE_MODEL || 'claude-sonnet-4-6',
        max_tokens:2000,
        temperature:0.5,
        system:SYSTEM,
        messages:[{role:'user',content:`구조화된 이번 주 사실:\n${JSON.stringify(facts,null,2)}`}],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic ${response.status}`);
    const data = await response.json();
    const raw = (data.content||[]).filter((item)=>item.type==='text').map((item)=>item.text).join('').trim();
    const result = finalize(parseDraft(raw), 'llm');
    const g = result.guard;
    if (g.opening || g.scenes || g.dayLines.length || g.themes || g.experiment)
      console.warn(`reflection guard: opening=${g.opening} scenes=${g.scenes} dayLines=${g.dayLines.join(',')||'-'} themes=${g.themes} experiment=${g.experiment}`);
    return result;
  } catch (error) {
    console.warn(`weekly synthesis fallback: ${error.message}`);
    return fallback();
  }
}

function reportByDay(metrics, selfReports) {
  const byDate = new Map();
  for (const report of selfReports || []) if (report?.date) byDate.set(String(report.date).slice(0, 10), report);
  return Object.fromEntries(DAYS.map((day) => [day, byDate.get(metrics.dateByDay?.[day]) || null]));
}

export function dayFacts(metrics, selfReports) {
  const reports = reportByDay(metrics, selfReports);
  return Object.fromEntries(DAYS.map((day) => {
    const report = reports[day];
    return [day, {
      date:metrics.dateByDay?.[day] || null,
      committed_hours:metrics.committedByDay?.[day] ?? 0,
      events:(metrics.eventHistory || []).filter((event) => event.day === day).map((event) => event.title),
      has_report:Boolean(report),
      score:Number.isFinite(report?.score) ? report.score : null,
    }];
  }));
}

export function calendarDayLine(day, metrics) {
  const tail = ` · 구속 시간 ${metrics.committedByDay?.[day] ?? 0}h`;
  const events = (metrics.eventHistory || []).filter((event) => event.day === day);
  const timed = events.filter((event) => Number.isFinite(event.durationHours)).sort((a, b) => b.durationHours - a.durationHours);
  if (timed.length) return `'${timed[0].title}' 중심의 하루${tail}`;
  if (events.length) return `'${events[0].title}' 일정이 걸쳐 있던 날${tail}`;
  return `등록된 일정 없이 평소 루틴으로 보낸 날${tail}`;
}

export function fallbackDraft(metrics, analysis) {
  const life = analysis.lifeContext;
  const change = analysis.changes?.[0];
  const event = analysis.notableEvents?.items?.[0];
  const concrete = event ? `${event.title} — ${event.reasons.join(', ')}` : change?.title || '이번 주의 리듬';
  const openingNote = life?.present
    ? `생활 업데이트 ${life.count}건이 캘린더 밖의 실제 상태를 보완한 한 주였습니다. 계획보다 실제로 달라진 맥락부터 살펴보세요.`
    : `이번 주의 결을 바꾼 장면은 ${concrete}입니다. 숫자보다 달라진 맥락부터 살펴보세요.`;
  const scenes = (analysis.notableEvents?.items || []).filter((item) => DAYS.includes(item.day)).slice(0, 2)
    .map((item) => ({ day:item.day, title:item.title, detail:`${item.reasons.join(', ')}.` }));
  const candidate = analysis.experimentCandidate || {};
  return {
    openingNote,
    scenes,
    dayLines:Object.fromEntries(DAYS.map((day) => [day, calendarDayLine(day, metrics)])),
    themes:[],
    experiment:{ title:candidate.title || '', detail:candidate.detail || '' },
  };
}

export function parseDraft(raw) {
  const value = parseJson(raw);
  if (!validDraft(value)) throw new Error('Invalid synthesis JSON');
  const text = (input) => String(input).trim();
  return {
    openingNote:text(value.opening_note),
    scenes:value.scenes.slice(0, 3).map((scene) => ({ day:scene.day, title:text(scene.title), detail:text(scene.detail) })),
    dayLines:Object.fromEntries(DAYS.map((day) => [day, text(value.day_lines[day])])),
    themes:value.themes.slice(0, 4).map((theme) => ({ name:text(theme.name), detail:text(theme.detail) })),
    experiment:{ title:text(value.experiment.title), detail:text(value.experiment.detail) },
  };
}

function validDraft(value) {
  const filled = (input) => typeof input === 'string' && input.trim().length > 0;
  if (!value || !filled(value.opening_note)) return false;
  if (!value.day_lines || !DAYS.every((day) => filled(value.day_lines[day]))) return false;
  if (!Array.isArray(value.scenes) || !value.scenes.every((scene) => DAYS.includes(scene?.day) && filled(scene.title) && filled(scene.detail))) return false;
  if (!Array.isArray(value.themes) || !value.themes.every((theme) => filled(theme?.name) && filled(theme.detail))) return false;
  return filled(value.experiment?.title) && filled(value.experiment?.detail);
}

export function themeRecentWeeks(name, history) {
  const key = normalizeText(name);
  const prior = (history || []).slice(-4)
    .filter((row) => (row.themes || []).some((theme) => normalizeText(theme) === key)).length;
  return prior + 1;
}

export function finalizeReflection({ draft, source, metrics, analysis, selfReports = [], history = [], lifeContexts = [], lifeContextRecent = [] }) {
  const computed = fallbackDraft(metrics, analysis);
  // Only model output can have copied an original; the computed draft is built
  // from calendar facts alone.
  const sources = source === 'llm' ? sourceTexts({ selfReports, lifeContexts, lifeContextRecent }) : [];
  const copied = (...texts) => texts.some((text) => overlapsSource(text, sources));
  const guard = { opening:false, scenes:0, dayLines:[], themes:0, experiment:false };

  let openingNote = { text:draft.openingNote, source };
  if (copied(draft.openingNote)) { openingNote = { text:computed.openingNote, source:'fallback' }; guard.opening = true; }

  const scenes = (draft.scenes || []).filter((scene) => {
    if (!copied(scene.title, scene.detail)) return true;
    guard.scenes += 1;
    return false;
  });

  const reports = reportByDay(metrics, selfReports);
  const dayLines = Object.fromEntries(DAYS.map((day) => {
    let text = draft.dayLines?.[day] || computed.dayLines[day];
    if (copied(text)) { text = computed.dayLines[day]; guard.dayLines.push(day); }
    const report = reports[day];
    return [day, { text, source:report ? 'report' : 'calendar', score:Number.isFinite(report?.score) ? report.score : null }];
  }));

  const reportedDays = DAYS.filter((day) => reports[day]).length;
  const seen = new Set();
  const themes = [];
  for (const theme of reportedDays >= 2 ? draft.themes || [] : []) {
    const key = normalizeText(theme.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (copied(theme.name, theme.detail)) { guard.themes += 1; continue; }
    themes.push({ name:theme.name.trim(), detail:theme.detail, recentWeeks:themeRecentWeeks(theme.name, history) });
  }

  let experiment = { p:1, ...draft.experiment, source };
  if (copied(draft.experiment?.title, draft.experiment?.detail)) {
    experiment = { p:1, ...computed.experiment, source:'fallback' };
    guard.experiment = true;
  }

  return { openingNote, scenes, dayLines, themes, experiment, source, guard };
}

function buildFacts(m, analysis, selfReports, history, lifeContexts, lifeContextRecent, rememberedBaselines) {
  return {
    sleep:{average:m.sleepAvg,minimum:m.sleepMin,known:m.sleepKnown,confidence:m.sleepKnown?'actual':'estimate'},
    day_facts:dayFacts(m, selfReports),
    changes:analysis.changes,
    selected_special_events:analysis.notableEvents,
    all_calendar_events:m.eventHistory,
    self_reports:selfReports,
    life_context_summary:analysis.lifeContext,
    weekly_life_context:compactLifeContext(lifeContexts),
    recent_life_context:compactLifeContext(lifeContextRecent),
    remembered_baselines:rememberedBaselines,
    next_week:analysis.preview,
    candidate_experiment:analysis.experimentCandidate,
    recent_themes:history.slice(-4).map((row)=>({week:row.week,themes:row.themes||[]})),
    guardrails:['수면이 추정치면 회복 정도를 단정하지 않기','이동시간 역산 조언 반복 금지','원문 문장을 그대로 옮기지 않기'],
  };
}

function compactLifeContext(rows) {
  return (rows || []).slice(-30).map(({ text, starts_on, expires_on, created_at, carried_in }) =>
    ({ text, starts_on, expires_on, created_at, carried_in:Boolean(carried_in) }));
}

function parseJson(raw) {
  const cleaned=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const start=cleaned.indexOf('{'); const end=cleaned.lastIndexOf('}');
  if(start<0||end<start)throw new Error('No JSON object');
  return JSON.parse(cleaned.slice(start,end+1));
}
