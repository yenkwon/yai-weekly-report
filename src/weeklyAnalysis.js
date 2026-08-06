// Deterministic facts for the weekly report. The LLM writes prose, not numbers.
const KO = { mon:'월', tue:'화', wed:'수', thu:'목', fri:'금', sat:'토', sun:'일' };
const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const r1 = (n) => Math.round(n * 10) / 10;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const std = (values) => { const avg = mean(values); return values.length ? Math.sqrt(mean(values.map((value) => (value - avg) ** 2))) : 0; };

function othersVsSelf(m, cfg) {
  const split = cfg.routine.carTimeSplit;
  const calls = m.buckets.commute * split.calls;
  const learning = m.buckets.commute * split.learning;
  const others = m.buckets.ministry + m.buckets.worship + m.buckets.social + calls;
  const self = m.buckets.selfcare + m.buckets.growth + learning;
  const pool = others + self || 1;
  const othersPct = Math.round(others / pool * 100);
  const selfPct = Math.round(self / pool * 100);
  return { key:'others_self', tone:selfPct < 12 ? 'watch' : 'note', othersPct, selfPct,
    title:`타인 ${othersPct}% · 나 ${selfPct}%`,
    detail:`방향이 분명한 시간 중 타인을 향한 시간은 ${others.toFixed(0)}h, 나를 위한 시간은 ${self.toFixed(0)}h입니다.` };
}

function recoveryStatus(m, history, cfg, sleepKnown) {
  if (!sleepKnown) return { key:'recovery_debt', tone:'note', weekly:null, balance:null, confidence:'estimate',
    title:'회복 판단은 보류', detail:`수면 ${m.sleepAvg}h는 기본 루틴 추정치입니다. 실제 수면이 확인되기 전에는 회복 부채를 누적하지 않습니다.` };
  const target = cfg.routine.recoveryTarget.sleepPerNight * 7 + cfg.routine.recoveryTarget.selfcarePerWeek;
  const actual = m.buckets.sleep + m.buckets.selfcare;
  const weekly = r1(actual - target);
  const previousKnown = [...history].reverse().find((row) => row.sleepKnown && Number.isFinite(row.recoveryBalance));
  const balance = r1((previousKnown?.recoveryBalance || 0) + weekly);
  return { key:'recovery_debt', tone:balance < -12 ? 'watch' : balance >= 0 ? 'win' : 'note', weekly, balance, confidence:'actual',
    title:`확인된 회복 잔고 ${balance > 0 ? '+' : ''}${balance}h`, detail:`실제 수면과 자기돌봄 ${actual.toFixed(1)}h, 주간 목표 ${target}h를 비교했습니다.` };
}

function perceivedVsActual(m, reports) {
  if (!reports?.length) return { key:'perceived', tone:'note', present:false, avgScore:null, count:0, gap:null,
    title:'체감 기록 없음', detail:'자기보고가 없어서 일정 부하와 체감을 함께 비교하지 못했습니다.' };
  const scores = reports.map((row) => row.score).filter(Number.isFinite);
  const avgScore = scores.length ? r1(mean(scores)) : null;
  const byDate = Object.fromEntries(reports.filter((row) => row.date).map((row) => [row.date, row]));
  let gap = null;
  for (const day of DAYS) {
    const report = byDate[m.dateByDay?.[day]];
    if (!report || !Number.isFinite(report.score)) continue;
    const load = m.committedByDay[day];
    const text = report.score >= 4 && load >= 13 ? `${KO[day]}요일은 ${load}h로 무거웠지만 체감은 ${report.score}점이었습니다.`
      : report.score <= 2 && load <= 9 ? `${KO[day]}요일은 ${load}h로 비교적 가벼웠지만 체감은 ${report.score}점이었습니다.` : null;
    if (text && (!gap || Math.abs(load - 11) > gap.distance)) gap = { text, load, score:report.score, note:report.note || report.raw || '', distance:Math.abs(load - 11) };
  }
  return { key:'perceived', tone:'note', present:true, avgScore, count:reports.length, gap,
    title:`체감 ${avgScore ?? '–'}점 · ${reports.length}일 기록`, detail:gap?.text || '기록된 날에는 체감과 일정 부하가 대체로 같은 방향이었습니다.' };
}

function changesFor(m, history, selfPct) {
  const previous = history.at(-1) || null;
  const baselineRows = history.slice(-4);
  const specs = [
    { key:'ministry', label:'사역·예배', now:r1(m.buckets.ministry + m.buckets.worship), unit:'h', threshold:2, read:(r)=>r1((r.buckets?.ministry||0)+(r.buckets?.worship||0)) },
    { key:'peak', label:'가장 긴 하루', now:m.peakCommitted, unit:'h', threshold:1, read:(r)=>r.peakCommitted },
    { key:'late', label:'밤 10시 이후 일정', now:m._lateNightCount||0, unit:'건', threshold:1, read:(r)=>r.lateNightCount||0 },
    { key:'self', label:'나를 위한 시간 비중', now:selfPct, unit:'%p', threshold:4, read:(r)=>r.selfPct },
    { key:'sleep', label:'수면 평균', now:m.sleepAvg, unit:'h', threshold:.25, read:(r)=>r.sleepAvg, estimated:!m.sleepKnown },
  ];
  return specs.map((spec) => {
    const vals = baselineRows.map(spec.read).filter(Number.isFinite);
    const baseline = vals.length ? r1(mean(vals)) : null;
    const prevValue = previous ? spec.read(previous) : null;
    const weekDelta = Number.isFinite(prevValue) ? r1(spec.now - prevValue) : null;
    const baselineDelta = Number.isFinite(baseline) ? r1(spec.now - baseline) : null;
    const magnitude = Math.max(Math.abs(weekDelta||0), Math.abs(baselineDelta||0));
    return { key:spec.key, label:spec.label, value:spec.now, unit:spec.unit, weekDelta, baseline, baselineDelta,
      significant:magnitude >= spec.threshold && !spec.estimated, confidence:spec.estimated?'estimate':'measured', score:magnitude/spec.threshold };
  }).sort((a,b)=>b.score-a.score).slice(0,3).map((change) => ({ ...change,
    tone:change.significant ? ((change.weekDelta ?? change.baselineDelta ?? 0) > 0 ? 'up':'down') : 'flat',
    title:`${change.label} ${change.value}${change.unit}`,
    detail:`${change.weekDelta==null?'지난주 비교 없음':`지난주보다 ${signed(change.weekDelta)}${change.unit}`} · ${change.baseline==null?'4주 기준선 축적 중':`최근 4주 평균 ${change.baseline}${change.unit} 대비 ${signed(change.baselineDelta)}${change.unit}`}${change.confidence==='estimate'?' · 수면은 추정치':''}` }));
}

function notableFor(m, history) {
  const priorRows = history.slice(-4).filter((row) => Array.isArray(row.eventHistory));
  const priorByTitle = new Map();
  for (const event of priorRows.flatMap((row) => row.eventHistory)) {
    const key = eventKey(event.title); const rows = priorByTitle.get(key)||[]; rows.push(event); priorByTitle.set(key, rows);
  }
  const comparisonReady = priorRows.length > 0;
  const candidates = [];
  for (const event of m.eventHistory || []) {
    const prior = priorByTitle.get(eventKey(event.title)) || [];
    const reasons=[]; let rank=0;
    if (comparisonReady && prior.length===0) { reasons.push('최근 4주에 없던 일정'); rank+=4; }
    if (event.allDay) { reasons.push('종일·기간 일정'); rank+=2; }
    if (event.durationHours>=5) { reasons.push(`${event.durationHours}h 장시간 일정`); rank+=3; }
    if (!event.allDay && localHour(event.start)>=22) { reasons.push('밤 10시 이후 시작'); rank+=2; }
    const durations=prior.map((row)=>row.durationHours).filter(Number.isFinite);
    if (durations.length) {
      const usual=mean(durations);
      if (event.durationHours>=usual*1.8 && event.durationHours-usual>=1) { reasons.push(`평소 ${r1(usual)}h보다 길었음`); rank+=4; }
      const days=new Set(prior.map((row)=>row.day).filter(Boolean));
      if (days.size===1 && !days.has(event.day)) { reasons.push(`평소 ${KO[[...days][0]]}요일에서 이동`); rank+=2; }
    }
    if (reasons.length) candidates.push({...event,reasons,rank});
  }
  for (const routine of m.nonCalendarRoutines?.items || []) {
    if (!routine.activeFrom || !Object.values(m.dateByDay || {}).includes(routine.activeFrom)) continue;
    const day=Object.entries(m.dateByDay).find(([,date])=>date===routine.activeFrom)?.[0];
    candidates.push({title:routine.title,category:routine.category,start:routine.activeFrom,end:routine.activeFrom,
      durationHours:routine.minutes?r1(routine.minutes/60):null,allDay:false,day,reasons:['이번 주 시작한 캘린더 밖 루틴'],rank:5});
  }
  const items=[...new Map(candidates.sort((a,b)=>b.rank-a.rank).map((item)=>[`${item.title}|${item.start}`,item])).values()].slice(0,4);
  return { comparisonReady, items, note:comparisonReady ? (items.length?'최근 4주와 비교해 예외적인 일정만 골랐습니다.':'최근 4주와 비교해 큰 예외 일정은 없었습니다.')
    :'원문 일정 이력을 이번 주부터 쌓아 다음 리포트부터 새 일정과 반복 일정을 구분합니다.' };
}

function preview(nextEvents, catmap) {
  if (!nextEvents?.length) return { title:'다음 주 미리보기', detail:'등록된 다음 주 일정이 없습니다.', flags:[], banners:[] };
  const dayHours=Object.fromEntries(DAYS.map((day)=>[day,0])); const banners=[];
  for (const event of nextEvents) {
    if (event.allDay) { banners.push(event.title); continue; }
    if (!['ministry','worship'].includes(bucketOf(event,catmap))) continue;
    for (const segment of splitAcrossKstDays(event)) dayHours[segment.day]+=segment.hours;
  }
  const flags=DAYS.filter((day)=>dayHours[day]>=8).map((day)=>`${KO[day]}요일 사역 ${r1(dayHours[day])}h`);
  const heavy=DAYS.reduce((a,b)=>dayHours[b]>dayHours[a]?b:a); const parts=[];
  if (dayHours[heavy]>0) parts.push(`가장 무거운 날은 ${KO[heavy]}요일 사역 ${r1(dayHours[heavy])}h`);
  if (banners.length) parts.push(`종일·기간 일정 ${banners.slice(0,2).join(', ')}`);
  return { title:'다음 주 미리보기', detail:parts.length?`${parts.join(' · ')}.`:'시간으로 계산할 사역 일정 충돌은 없습니다.', flags, banners:banners.slice(0,3), dayHours };
}

function chooseExperiment(changes, notable, nextWeek, split) {
  if (nextWeek.flags.length) return {p:1,title:`${nextWeek.flags[0]} 전후 30분 비우기`,detail:'앞뒤 일정 하나를 줄여 실제 여백이 생기는지 한 주만 확인합니다.'};
  const newRoutine=notable.items.find((item)=>item.reasons.includes('이번 주 시작한 캘린더 밖 루틴'));
  if (newRoutine) return {p:1,title:`${newRoutine.title} 10분 슬롯 고정`,detail:'새 루틴이 다른 일정에 밀리지 않는지 한 주만 같은 시간에 실행해 봅니다.'};
  const late=changes.find((change)=>change.key==='late'&&change.value>0);
  if (late) return {p:1,title:'밤 10시 이후 일정 한 건만 줄이기',detail:`이번 주 ${late.value}건 중 조정 가능한 한 건을 골라 다음 날 체감 차이를 확인합니다.`};
  const fresh=notable.items.find((item)=>item.reasons.includes('최근 4주에 없던 일정'));
  if (fresh) return {p:1,title:`${fresh.title} 뒤 20분 비우기`,detail:'새 일정이 남긴 체력 비용을 다음 자기보고에서 확인합니다.'};
  if (split.selfPct<15) return {p:1,title:'나를 위한 30분 한 칸 확보',detail:'다음 주 한 번만 보호하고 자기보고 점수가 달라지는지 확인합니다.'};
  return {p:1,title:'이번 주 가장 편안했던 패턴 한 번 반복',detail:'새 규칙을 더 만들기보다 체감이 좋았던 하루의 한 요소를 다음 주에 재현합니다.'};
}

export function analyze(m, history, reports, nextEvents, cfg, catmap, options={}) {
  m.sleepKnown=Boolean(options.sleepKnown);
  const split=othersVsSelf(m,cfg); const recovery=recoveryStatus(m,history,cfg,m.sleepKnown);
  const rhythm={key:'rhythm',tone:'note',variance:r1(std(DAYS.map((d)=>m.committedByDay[d]))),lateNight:m._lateNightCount||0,
    title:`요일 편차 ${r1(std(DAYS.map((d)=>m.committedByDay[d])))}h · 밤 10시 이후 ${m._lateNightCount||0}건`, detail:`가장 긴 날은 ${KO[m.peakDay]}요일 ${m.peakCommitted}h였습니다.`};
  const perceived=perceivedVsActual(m,reports); const changes=changesFor(m,history,split.selfPct);
  const notableEvents=notableFor(m,history); const nextWeek=preview(nextEvents,catmap);
  const experimentCandidate=chooseExperiment(changes,notableEvents,nextWeek,split);
  return { changes, notableEvents, discovery:{title:changes[0]?.title||'비교 기준을 쌓는 주',detail:changes[0]?.detail||'다음 주부터 비교합니다.'},
    lenses:[split,recovery,rhythm,perceived], preview:nextWeek, recommendations:[experimentCandidate], experimentCandidate,
    subjective:{present:perceived.present,avgScore:perceived.avgScore,count:perceived.count,gap:perceived.gap,detail:perceived.detail},
    historyRow:{othersPct:split.othersPct,selfPct:split.selfPct,recoveryWeekly:recovery.weekly,recoveryBalance:recovery.balance,sleepKnown:m.sleepKnown,
      lateNightCount:m._lateNightCount||0,loadStdev:rhythm.variance,avgScore:perceived.avgScore,
      insightTopics:[changes[0]?.key,...notableEvents.items.slice(0,2).map((item)=>eventKey(item.title))].filter(Boolean)} };
}

function bucketOf(event,catmap){for(const o of catmap.keywordOverrides)if(new RegExp(o.match,'i').test(event.title||''))return o.bucket;for(const[n,b]of Object.entries(catmap.calendars))if((event.calendar||'').includes(n))return b;return'life';}
function splitAcrossKstDays(event){const out=[];let cursor=new Date(event.start);const end=new Date(event.end);while(cursor<end){const date=kstDate(cursor);const next=new Date(`${addDays(date,1)}T00:00:00+09:00`);const stop=end<next?end:next;const day=DAYS[(new Date(`${date}T00:00:00Z`).getUTCDay()+6)%7];out.push({day,hours:(stop-cursor)/3.6e6});cursor=stop;}return out;}
function kstDate(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function addDays(key,days){const date=new Date(`${key}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function localHour(iso){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map((x)=>[x.type,x.value]));return Number(p.hour)+Number(p.minute||0)/60;}
function eventKey(title){return String(title||'').normalize('NFKC').toLowerCase().replace(/\([^)]*\d[^)]*\)/g,' ').replace(/\b\d+\b/g,' ').replace(/\s+/g,' ').trim();}
function signed(value){return`${value>0?'+':''}${value}`;}
