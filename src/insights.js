// insights.js — the analytical core.
// 5 lenses (타인vs나 / 회복부채 / 리듬 / 지킴vs무너짐 / 체감vs실제) + 이번 주의 발견(이례치)
// + 다음 주 미리보기 + 추천. Objective lenses always run; subjective ones only when self-report exists.
const KO = { mon:'월',tue:'화',wed:'수',thu:'목',fri:'금',sat:'토',sun:'일' };
const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const r1 = (n) => Math.round(n*10)/10;
const mean = (a) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const std  = (a) => { const m=mean(a); return a.length ? Math.sqrt(mean(a.map(x=>(x-m)**2))) : 0; };

// ---------- LENS 1: 타인 vs 나 ----------
function othersVsSelf(m, cfg) {
  const split = cfg.routine.carTimeSplit;          // {learning, calls}
  const b = m.buckets;
  const callsH = b.commute * split.calls, learnH = b.commute * split.learning;
  const others = b.ministry + b.worship + b.social + callsH;
  const self   = b.selfcare + b.growth + learnH;     // free time excluded (ambiguous)
  const pool = others + self || 1;
  const othersPct = Math.round(others/pool*100), selfPct = Math.round(self/pool*100);
  const tone = selfPct < 12 ? 'watch' : 'note';
  return { key:'others_self', tone, othersPct, selfPct,
    title:`타인 ${othersPct}% · 나 ${selfPct}%`,
    detail:`깨어있는 시간 중 타인을 향한 시간이 ${others.toFixed(0)}h, 온전히 나를 위한 시간이 ${self.toFixed(0)}h. ` +
           (selfPct<12 ? '나 지향 비율이 낮은 주예요 — 비난이 아니라 균형의 거울로.' : '섬김 속에서도 나를 위한 칸이 남아있었어요.') };
}

// ---------- LENS 2: 회복 부채 (cumulative) ----------
function recoveryDebt(m, history, cfg) {
  const t = cfg.routine.recoveryTarget;
  const target = t.sleepPerNight*7 + t.selfcarePerWeek;
  const actual = m.buckets.sleep + m.buckets.selfcare;     // clean signals only (free-time hook = future)
  const weekly = r1(actual - target);
  const prevBal = history.length ? (history[history.length-1].recoveryBalance ?? 0) : 0;
  const balance = r1(prevBal + weekly);
  const dir = weekly >= 0 ? '개선' : '악화';
  const tone = balance < -12 ? 'watch' : balance >= 0 ? 'win' : 'note';
  return { key:'recovery_debt', tone, weekly, balance,
    title:`회복 부채 ${balance>0?'+':''}${balance}h`,
    detail:`이번 주 수면+자기돌봄 ${actual.toFixed(0)}h vs 목표 ${target}h → ${weekly>0?'+':''}${weekly}h(${dir}). ` +
           (balance<0 ? `누적 잔고 ${balance}h — ${balance<-12?'며칠이라도 갚을 주가 필요해요.':'아직 감당 범위.'}` : '잔고 흑자 — 잘 회복하고 있어요.') };
}

// ---------- LENS 3: 리듬 (부하의 모양) ----------
function rhythm(m) {
  const loads = DAYS.map(d=>m.committedByDay[d]);
  const variance = r1(std(loads));
  const lateNight = m.special ? 0 : 0;
  const late = m._lateNightCount ?? 0;
  const latest = m._latestEnd ?? null;
  const tone = (late>=3 || variance>=3.5) ? 'watch' : 'note';
  const parts = [`요일별 편차 ${variance}h(${variance>=3.5?'몰아친 주':'고른 주'})`];
  if (late) parts.push(`심야(22시 이후) 일정 ${late}건`);
  if (latest) parts.push(`최장 ${KO[m.peakDay]==null?'':''}귀가/마감 ${latest}`);
  return { key:'rhythm', tone, variance, lateNight:late,
    title:`리듬: ${variance>=3.5?'쏠림':'평탄'} · 심야 ${late}건`,
    detail: parts.join(' · ') + '. 같은 총량도 고르게 퍼졌는지, 며칠에 몰렸는지가 회복을 가릅니다.' };
}

// ---------- LENS 4: 지킴 vs 무너짐 (양방향 streak) ----------
function streaks(m, history) {
  const back = (pred, includeNow) => { let s = includeNow?1:0;
    if (includeNow) for (let i=history.length-1;i>=0 && pred(history[i]);i--) s++; return s; };
  const keeping = [], breaking = [];
  if (m.flags.satSleepover) keeping.push(`토요일 1박 ${back(h=>h.flags?.satSleepover, true)}주 연속 ✅`);
  if (m.flags.sundaySleep7) keeping.push(`일요일 수면 7h+ ${back(h=>h.flags?.sundaySleep7, true)}주 연속 ✅`);
  if (m.restDays===0) breaking.push(`완전한 휴일 0일 ${m.zeroRestStreak}주 연속 ⚠️`);
  if (m.flags.exerciseZero) breaking.push(`운동 0h ${back(h=>h.flags?.exerciseZero, true)}주 연속 ⚠️`);
  if (m.flags.selfcareZero) breaking.push(`자기돌봄 0 ${back(h=>h.flags?.selfcareZero, true)}주 연속 ⚠️`);
  return { key:'streaks', tone: breaking.length>keeping.length ? 'watch':'win',
    title:'지키는 것 / 무너지는 것', keeping, breaking,
    detail: [keeping.length?`지킴 — ${keeping.join(', ')}`:'', breaking.length?`무너짐 — ${breaking.join(', ')}`:''].filter(Boolean).join('  |  ') };
}

// ---------- LENS 5: 체감 vs 실제 (self-report only) ----------
function perceivedVsActual(m, selfReport) {
  if (!selfReport?.length) return null;
  const byDate = {}; selfReport.forEach(r=>{ if(r.score!=null) byDate[r.date]=r; });
  const scores = selfReport.map(r=>r.score).filter(s=>s!=null);
  const avg = scores.length ? r1(mean(scores)) : null;
  // biggest gap: a high-load day with a high score, or a low-load day with a low score
  let gap = null;
  for (const d of DAYS) {
    const iso = m.dateByDay?.[d]; const r = iso && byDate[iso]; if (!r) continue;
    const load = m.committedByDay[d];
    const mismatch = (r.score>=4 && load>=13) ? `${KO[d]} 가장 무거운 축인데 체감 ${r.score}점` :
                     (r.score<=2 && load<=9) ? `${KO[d]} 가벼운 날인데 체감 ${r.score}점` : null;
    if (mismatch && (!gap || load>gap.load)) gap = { text:mismatch, load, note:r.note };
  }
  return { key:'perceived', tone:'note', avgScore:avg,
    title:`체감 에너지 평균 ${avg ?? '–'}점`,
    detail: (gap ? `주목할 갭 — ${gap.text}. ` : '체감과 실제 부하가 대체로 나란했어요. ') +
            (avg!=null ? `한 주 7일 자기보고 기준.` : '') ,
    gap };
}

// ---------- 이번 주의 발견 (anomaly vs baseline) ----------
function discovery(m, history) {
  if (history.length < 2)
    return { title:'기준 주차', detail:'아직 비교할 과거가 적어요. 다음 주부터 평소와 다른 점을 자동으로 짚어드릴게요.' };
  const base = history.slice(-4);
  const cand = [
    { name:`${KO[m.peakDay]}요일 부하`, now:m.peakCommitted, base:mean(base.map(h=>h.peakCommitted)), unit:'h' },
    { name:'사역+예배', now:m.buckets.ministry+m.buckets.worship, base:mean(base.map(h=>(h.buckets?.ministry||0)+(h.buckets?.worship||0))), unit:'h' },
    { name:'수면 평균', now:m.sleepAvg, base:mean(base.map(h=>h.sleepAvg)), unit:'h', lowerWorse:true },
    { name:'심야 일정', now:m._lateNightCount||0, base:mean(base.map(h=>h.lateNightCount||0)), unit:'건' },
  ];
  let best=null;
  for (const c of cand){ const diff=c.now-c.base; const rel=Math.abs(diff)/(Math.abs(c.base)||1);
    if (!best || rel>best.rel) best={...c,diff:r1(diff),rel}; }
  if (best.rel < 0.18) return { title:'이례적으로 평탄한 주', detail:'평소 리듬과 크게 다르지 않았어요. 가끔은 이런 주가 회복의 기회.' };
  const up = best.diff>0;
  return { title:`이번 주의 발견 — ${best.name} ${up?'▲':'▼'}${Math.abs(best.diff)}${best.unit}`,
    detail:`평소 약 ${r1(best.base)}${best.unit} → 이번 주 ${r1(best.now)}${best.unit}. 4주 평균 대비 ${Math.round(best.rel*100)}% ${up?'증가':'감소'}.` };
}

// ---------- 다음 주 미리보기 ----------
function preview(nextEvents, cfg, catmap) {
  if (!nextEvents?.length) return { title:'다음 주 미리보기', detail:'다음 주 캘린더가 아직 비어 있어요.', flags:[] };
  const tz = cfg.routine.timezone;
  const dayMin = Object.fromEntries(DAYS.map(d=>[d,0]));
  const bucketOf = (ev)=>{ for(const k of catmap.keywordOverrides) if(new RegExp(k.match,'i').test(ev.title||'')) return k.bucket;
    for(const [n,b] of Object.entries(catmap.calendars)) if((ev.calendar||'').includes(n)) return b; return 'life'; };
  for (const ev of nextEvents){ const d=new Date(new Date(ev.start).toLocaleString('en-US',{timeZone:tz}));
    const day=DAYS[(d.getDay()+6)%7]; const b=bucketOf(ev); const h=(new Date(ev.end)-new Date(ev.start))/3.6e6;
    if(['ministry','worship'].includes(b)) dayMin[day]+=h; }
  const flags=[]; for(const d of DAYS) if(dayMin[d]>=8) flags.push(`${KO[d]}요일 사역 ${r1(dayMin[d])}h 예정 — 무거움`);
  const heaviest = DAYS.reduce((a,b)=>dayMin[b]>dayMin[a]?b:a);
  return { title:'다음 주 미리보기',
    detail: flags.length ? `${flags.join(' · ')}. 가장 무거운 날 전후로 수면을 미리 확보해두세요.`
                         : `다음 주는 ${KO[heaviest]}요일이 상대적으로 무거워요(사역 ${r1(dayMin[heaviest])}h). 큰 충돌은 없어 보입니다.`,
    flags };
}

// ---------- recommendations (data-driven, prioritized) ----------
function recommend(m, lenses) {
  const rec=[];
  const rd = lenses.find(l=>l.key==='recovery_debt');
  if (rd && rd.balance < -10) rec.push({p:1,title:'다음 주 반나절 회복 블록 1개', detail:`회복 부채 ${rd.balance}h — 일·사역·학습이 0인 반나절을 미리 비워 부채를 갚기.`});
  if (m.peakDay==='thu' || m.sleepMin<5.8) rec.push({p:1,title:'목요일 밤 양평 일찍 출발', detail:'연습 30분 단축 또는 목요일 재택. 금요일 아침 수면부터 끊기.'});
  if (m.flags.exerciseZero) rec.push({p:2,title:'운동을 동선에 얹기', detail:'양평 도착 후 10분 걷기부터. 빈 Work Out 캘린더 깨우기.'});
  if (m.flags.selfcareZero) rec.push({p:2,title:'회복 일정 1개 보호', detail:'로즈마리 같은 자기돌봄을 미팅에 밀리지 않는 약속으로 고정.'});
  const os = lenses.find(l=>l.key==='others_self');
  if (os && os.selfPct<12) rec.push({p:2,title:'나 지향 시간 한 칸', detail:'타인 비율이 높은 주 — 혼자만의 30분을 의도적으로 끼워넣기.'});
  rec.push({p:3,title:'악보·PPT 준비 한 타임에 모으기', detail:'목·주일 악보, YJDS·로고스 PPT를 묶어 전환 비용·밤작업 줄이기.'});
  return rec.sort((a,b)=>a.p-b.p).slice(0,5);
}

export function analyze(m, history, selfReport, nextEvents, cfg, catmap) {
  const L = [ othersVsSelf(m,cfg), recoveryDebt(m,history,cfg), rhythm(m), streaks(m,history) ];
  const pva = perceivedVsActual(m, selfReport);
  if (pva) L.push(pva);
  const disc = discovery(m, history);
  const prev = preview(nextEvents, cfg, catmap);
  const rec  = recommend(m, L);
  // history patch for cumulative metrics
  const rd = L.find(l=>l.key==='recovery_debt'), os = L.find(l=>l.key==='others_self');
  const historyRow = {
    othersPct:os.othersPct, selfPct:os.selfPct,
    recoveryWeekly:rd.weekly, recoveryBalance:rd.balance,
    lateNightCount:m._lateNightCount||0, loadStdev:rhythm(m).variance,
    avgScore: pva?.avgScore ?? null,
  };
  return { discovery:disc, lenses:L, preview:prev, recommendations:rec,
           subjective: pva ? { present:true, avgScore:pva.avgScore, gap:pva.gap } : { present:false },
           historyRow };
}
