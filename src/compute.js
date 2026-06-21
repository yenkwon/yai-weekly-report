// compute.js — turns the routine template + one week of calendar events into
// a weekly time-budget model, plus deltas/streaks vs. history.
import fs from 'node:fs';

const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const WEEKDAYS = ['mon','tue','wed','thu','fri'];
const DAY_BY_JS = ['sun','mon','tue','wed','thu','fri','sat'];
const hm = (s) => { const [h,m] = s.split(':').map(Number); return h + m/60; };

export function loadConfig(dir = './config') {
  return {
    routine: JSON.parse(fs.readFileSync(`${dir}/routine.config.json`, 'utf8')),
    catmap:  JSON.parse(fs.readFileSync(`${dir}/category-map.json`, 'utf8')),
  };
}

function routineForPeriod(routine, periodStartLocal) {
  if (!periodStartLocal || !routine.officeDaysByQuarter) return routine;

  const wfhTemplate = Object.values(routine.weekdays).find((day) => day.mode === 'wfh') || routine.weekdays.mon;
  const officeTemplate = routine.weekdays.fri
    || Object.values(routine.weekdays).find((day) => String(day.mode || '').startsWith('office'))
    || wfhTemplate;
  const thuOfficeTemplate = routine.weekdays.thu || officeTemplate;
  const weekdays = {};
  const dateByDay = dateByDayForPeriod(periodStartLocal);
  const quarters = new Set();
  const actualOfficeDays = [];

  for (const day of WEEKDAYS) {
    const q = quarterFromDate(dateByDay[day] || periodStartLocal);
    quarters.add(q);
    const officeDays = new Set(routine.officeDaysByQuarter[String(q)] || []);
    if (officeDays.has(day)) {
      const source = day === 'thu' ? thuOfficeTemplate : officeTemplate;
      weekdays[day] = { ...source, mode: String(source.mode || 'office').startsWith('office') ? source.mode : 'office' };
      actualOfficeDays.push(day);
    } else {
      weekdays[day] = { ...wfhTemplate, mode: 'wfh' };
    }
  }

  return {
    ...routine,
    weekdays,
    _quarter: quarters.size === 1 ? [...quarters][0] : null,
    _quarters: [...quarters],
    _officeDays: actualOfficeDays,
  };
}

function quarterFromDate(dateKey) {
  const month = Number(String(dateKey).slice(5, 7));
  return Math.floor((month - 1) / 3) + 1;
}

function isOfficeDay(day) {
  return String(day?.mode || '').startsWith('office');
}

// Fixed spine (work, commute, sleep) is template-driven; it barely varies week to week.
function spine(routine) {
  const work = {}, commute = {}, sleep = { ...routine.sleepDefault };
  for (const d of DAYS) {
    const wd = routine.weekdays[d];
    work[d] = wd ? hm(wd.work[1]) - hm(wd.work[0]) : 0;
    commute[d] = commuteHoursForDay(d, routine);
  }
  return { work, commute, sleep };
}

function commuteHoursForDay(day, routine) {
  const C = routine.commuteHours;
  const W = routine.weekdays;
  const hasThuWorship = (routine.fixedMinistry?.thuWorshipHours || 0) > 0;

  if (day === 'sat') return routine.fixedMinistry?.satSleepover ? C.gunpo_yangpyeong : 0;
  if (day === 'sun') return routine.fixedMinistry?.satSleepover
    ? (routine.fixedMinistry?.sunChurch?.driveHomeHours ?? C.yangpyeong_gunpo)
    : 0;
  if (day === 'thu' && hasThuWorship) {
    return isOfficeDay(W.thu)
      ? C.daeyami_gwacheon + C.gwacheon_yangpyeong + C.yangpyeong_gunpo
      : C.gunpo_yangpyeong + C.yangpyeong_gunpo;
  }
  if (isOfficeDay(W[day])) return C.daeyami_gwacheon * 2;
  return 0;
}

function buildFixedBlocks(routine, sp) {
  const C = routine.commuteHours;
  const W = routine.weekdays;
  const fixed = Object.fromEntries(DAYS.map((day) => [day, [['sleep', 0, sp.sleep[day]]]]));

  for (const day of WEEKDAYS) {
    const wd = W[day];
    if (!wd?.work) continue;
    fixed[day].push(['work', hm(wd.work[0]), hm(wd.work[1])]);
    addWeekdayCommuteBlocks(fixed[day], day, routine);
  }

  if (routine.fixedMinistry?.satSleepover) {
    fixed.sat.push(['commute', 7, 7 + C.gunpo_yangpyeong]);
    const sc = routine.fixedMinistry.sunChurch;
    fixed.sun.push(['commute', hm(sc.end), hm(sc.end) + (sc.driveHomeHours ?? C.yangpyeong_gunpo)]);
  }

  return fixed;
}

function addWeekdayCommuteBlocks(blocks, day, routine) {
  const C = routine.commuteHours;
  const W = routine.weekdays;
  const wd = W[day];
  const workEnd = hm(wd.work[1]);
  const hasThuWorship = day === 'thu' && (routine.fixedMinistry?.thuWorshipHours || 0) > 0;

  if (hasThuWorship) {
    if (isOfficeDay(wd)) {
      if (wd.leaveHome) blocks.push(['commute', hm(wd.leaveHome), hm(wd.leaveHome) + C.daeyami_gwacheon]);
      blocks.push(['commute', workEnd, workEnd + C.gwacheon_yangpyeong]);
    } else {
      blocks.push(['commute', workEnd, workEnd + C.gunpo_yangpyeong]);
    }
    const returnEnd = routine.fixedMinistry.thuReturnEnd ? hm(routine.fixedMinistry.thuReturnEnd) : 23.25;
    blocks.push(['commute', returnEnd - C.yangpyeong_gunpo, returnEnd]);
    return;
  }

  if (isOfficeDay(wd)) {
    if (wd.leaveHome) blocks.push(['commute', hm(wd.leaveHome), hm(wd.leaveHome) + C.daeyami_gwacheon]);
    blocks.push(['commute', workEnd, workEnd + C.daeyami_gwacheon]);
  }
}

function expandRoutineEvents(events, routine) {
  const yjds = routine.fixedMinistry?.yjds;
  if (!yjds?.match || !yjds.prepLeadHours) return events;

  const re = new RegExp(yjds.match, 'i');
  const additions = [];
  for (const ev of events) {
    const title = ev.title || '';
    if (!re.test(title) || /준비|연습/i.test(title)) continue;

    const start = new Date(ev.start);
    const prepStart = new Date(start.getTime() - yjds.prepLeadHours * 3.6e6);
    if (hasOverlappingYjdsPrep(events, prepStart, start, ev, re)) continue;

    additions.push({
      title: yjds.prepTitle || 'YJDS 준비·연습',
      start: prepStart.toISOString(),
      end: ev.start,
      calendar: ev.calendar || 'Ministry Support',
      synthetic: true,
    });
  }
  return additions.length ? [...events, ...additions] : events;
}

function hasOverlappingYjdsPrep(events, start, end, source, re) {
  return events.some((ev) => {
    if (ev === source || !re.test(ev.title || '')) return false;
    return new Date(ev.start) < end && new Date(ev.end) > start;
  });
}

function dateByDayForPeriod(periodStartLocal) {
  if (!periodStartLocal) return {};
  if (typeof periodStartLocal === 'object') return periodStartLocal;

  const result = {};
  for (let i = 0; i < 7; i++) {
    const date = addDays(String(periodStartLocal).slice(0, 10), i);
    result[DAY_BY_JS[jsDay(date)]] = date;
  }
  return result;
}

function buildRoutineMeta(routine) {
  const sc = routine.fixedMinistry?.sunChurch || {};
  return {
    quarter: routine._quarter || null,
    quarters: routine._quarters || null,
    officeDays: routine._officeDays || WEEKDAYS.filter((day) => isOfficeDay(routine.weekdays[day])),
    sunday: {
      wake: sc.wake,
      prepStart: sc.prepStart || sc.start,
      start: sc.start,
      end: sc.end,
      worship: sc.worship,
    },
    yjds: routine.fixedMinistry?.yjds ? {
      name: routine.fixedMinistry.yjds.name,
      leader: routine.fixedMinistry.yjds.leader,
      role: routine.fixedMinistry.yjds.role,
      prepLeadHours: routine.fixedMinistry.yjds.prepLeadHours,
    } : null,
  };
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function jsDay(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// Map a single event to a bucket using calendar name, then keyword overrides.
function bucketOf(ev, catmap) {
  for (const k of catmap.keywordOverrides)
    if (new RegExp(k.match, 'i').test(ev.title || '')) return k.bucket;
  const cal = (ev.calendar || '').replace(/[^\w가-힣 /]/g, '').trim();
  for (const [name, b] of Object.entries(catmap.calendars))
    if (cal.includes(name)) return b;
  return 'life';
}

const dayKey = (iso, tz) => {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: tz }));
  return DAYS[(d.getDay() + 6) % 7]; // Mon=0
};
const durH = (ev) => Math.max(0, (new Date(ev.end) - new Date(ev.start)) / 3.6e6);

// Build the full weekly model.
export function buildWeek(events, cfg, sleepOverride = null, periodStartLocal = null) {
  const catmap = cfg.catmap;
  const routine = routineForPeriod(cfg.routine, periodStartLocal);
  const tz = routine.timezone;
  const sp = spine(routine);
  const expandedEvents = expandRoutineEvents(events, routine);
  if (sleepOverride) for (const d of DAYS)
    if (sleepOverride[d] != null) sp.sleep[d] = sleepOverride[d];

  // Variable buckets come from the actual calendar.
  const perDay = Object.fromEntries(DAYS.map(d => [d, {}]));
  const special = [];
  for (const ev of expandedEvents) {
    const d = dayKey(ev.start, tz);
    const b = bucketOf(ev, catmap);
    const h = durH(ev);
    perDay[d][b] = (perDay[d][b] || 0) + h;
    if (h >= 5) special.push({ day: d, title: ev.title, hours: +h.toFixed(1) });
  }

  // Sunday church is near-certain but usually unlogged → inject if missing.
  const sc = routine.fixedMinistry.sunChurch;
  const loggedSun = (perDay.sun.ministry || 0) + (perDay.sun.worship || 0);
  if (loggedSun < 3) perDay.sun.ministry = (perDay.sun.ministry || 0) + (hm(sc.end) - hm(sc.start));
  // Thursday worship spine if not logged
  const loggedThu = (perDay.thu.ministry || 0) + (perDay.thu.worship || 0);
  if (loggedThu < 1) perDay.thu.worship = (perDay.thu.worship || 0) + routine.fixedMinistry.thuWorshipHours;

  // Totals
  const buckets = Object.fromEntries(catmap.buckets.map(b => [b, 0]));
  const committed = {}, ministryDay = {};
  for (const d of DAYS) {
    buckets.work += sp.work[d];
    buckets.commute += sp.commute[d];
    buckets.sleep += sp.sleep[d];
    let mDay = 0;
    for (const [b, h] of Object.entries(perDay[d])) {
      if (b === 'life') continue;            // 'life' is the remainder, computed below
      buckets[b] = (buckets[b] || 0) + h;
      if (['ministry','worship'].includes(b)) mDay += h;
    }
    ministryDay[d] = mDay;
    committed[d] = +(sp.work[d] + sp.commute[d] + mDay).toFixed(2);
  }
  // life = whatever is left in each day after sleep+work+commute+variable buckets
  let accountedNonLife = 0;
  for (const b of catmap.buckets) if (b !== 'life') accountedNonLife += buckets[b];
  buckets.life = +(168 - accountedNonLife).toFixed(1);

  // ---- per-day clock-accurate blocks for the grid ----
  const localH = (iso) => { const d = new Date(new Date(iso).toLocaleString('en-US',{timeZone:tz})); return d.getHours()+d.getMinutes()/60; };
  const evByDay = Object.fromEntries(DAYS.map(d=>[d,[]]));
  for (const ev of expandedEvents) { const d = dayKey(ev.start, tz); const b = bucketOf(ev, catmap);
    if (['ministry','worship','career','social','growth','selfcare'].includes(b))
      evByDay[d].push([localH(ev.start), localH(ev.end), (b==='worship'?'ministry':b==='career'?'work':b)]); }
  // mirror the injected spine ministry into the grid when those events aren't logged
  if (evByDay.sun.filter(b=>b[2]==='ministry').length === 0) {
    const s = routine.fixedMinistry.sunChurch; evByDay.sun.push([hm(s.start), hm(s.end), 'ministry']); }
  if (evByDay.thu.filter(b=>b[2]==='ministry').length === 0)
    evByDay.thu.push([18.58, 18.58 + routine.fixedMinistry.thuWorshipHours, 'ministry']);
  const fixed = buildFixedBlocks(routine, sp);
  const dayBlocks = {};
  for (const d of DAYS) {
    const paint = new Array(288).fill('life');           // 5-min slots
    const put = (s,e,t)=>{ for(let i=Math.round(s*12);i<Math.round(e*12)&&i<288;i++) if(i>=0) paint[i]=t; };
    for (const [t,s,e] of fixed[d]) put(s,e,t);
    for (const [s,e,t] of evByDay[d]) put(s,e,t);
    const blocks=[]; let cur=paint[0], st=0;
    for (let i=1;i<=288;i++){ if(i===288||paint[i]!==cur){ blocks.push([+(st/12).toFixed(2),+(i/12).toFixed(2),cur]); cur=paint[i]; st=i; } }
    dayBlocks[d]=blocks;
  }

  const sleepVals = DAYS.map(d => sp.sleep[d]);

  // extra signals for the lenses
  const lh = (iso) => { const d = new Date(new Date(iso).toLocaleString('en-US',{timeZone:tz})); return d.getHours()+d.getMinutes()/60; };
  const lateNightCount = expandedEvents.filter(e => lh(e.start) >= 22).length;
  const latestEndH = expandedEvents.length ? Math.max(...expandedEvents.map(e => lh(e.end))) : null;
  const fmtHM = (h) => h==null ? null : `${String(Math.floor(h)).padStart(2,'0')}:${String(Math.round((h-Math.floor(h))*60)).padStart(2,'0')}`;
  const dateByDay = dateByDayForPeriod(periodStartLocal);

  const metrics = {
    committedByDay: committed,
    ministryByDay: ministryDay,
    sleepByDay: sp.sleep,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k,v]) => [k, +v.toFixed(1)])),
    peakDay: DAYS.reduce((a,b) => committed[b] > committed[a] ? b : a),
    peakCommitted: +Math.max(...DAYS.map(d => committed[d])).toFixed(1),
    restDays: DAYS.filter(d => committed[d] < 0.1).length,
    sleepAvg: +(sleepVals.reduce((a,b)=>a+b,0)/7).toFixed(2),
    sleepMin: +Math.min(...sleepVals).toFixed(2),
    drivingHours: +DAYS.reduce((a,d)=>a+sp.commute[d],0).toFixed(1),
    dayBlocks,
    spotlight: buildSpotlight(DAYS.reduce((a,b)=>committed[b]>committed[a]?b:a), dayBlocks, expandedEvents, tz),
    flags: {
      satSleepover: !!routine.fixedMinistry.satSleepover,
      sundaySleep7: sp.sleep.sun >= 7,
      exerciseZero: (buckets.exercise || 0) === 0,
      selfcareZero: (buckets.selfcare || 0) === 0,
      restZero: DAYS.filter(d => committed[d] < 0.1).length === 0,
    },
    _lateNightCount: lateNightCount,
    _latestEnd: fmtHM(latestEndH),
    dateByDay,
    special,
    routineMeta: buildRoutineMeta(routine),
  };
  return metrics;
}

// Deltas vs last week + streaks across history.
export function withTrends(metrics, history) {
  const prev = history[history.length - 1] || null;
  const delta = prev ? {
    peakCommitted: +(metrics.peakCommitted - prev.peakCommitted).toFixed(1),
    ministry: +(metrics.buckets.ministry + metrics.buckets.worship
              - (prev.buckets.ministry + prev.buckets.worship)).toFixed(1),
    sleepAvg: +(metrics.sleepAvg - prev.sleepAvg).toFixed(2),
  } : null;
  // streak: consecutive weeks (incl. this one) with zero full rest days
  let zeroRestStreak = metrics.restDays === 0 ? 1 : 0;
  if (metrics.restDays === 0)
    for (let i = history.length - 1; i >= 0 && history[i].restDays === 0; i--) zeroRestStreak++;
  return { ...metrics, delta, zeroRestStreak };
}

// ---- peak-day spotlight (labeled hour-by-hour timeline) ----
const KO = { mon:'월',tue:'화',wed:'수',thu:'목',fri:'금',sat:'토',sun:'일' };
const fmtH = (h)=>`${String(Math.floor(h)).padStart(2,'0')}:${String(Math.round((h-Math.floor(h))*60)).padStart(2,'0')}`;
export function buildSpotlight(day, dayBlocks, events, tz) {
  const localH = (iso)=>{const d=new Date(new Date(iso).toLocaleString('en-US',{timeZone:tz}));return d.getHours()+d.getMinutes()/60;};
  const dayEv = events.filter(e=>{const d=new Date(new Date(e.start).toLocaleString('en-US',{timeZone:tz}));return DAYS[(d.getDay()+6)%7]===day;})
    .map(e=>({s:localH(e.start),e:localH(e.end),t:e.title}));
  const lab = { commute:'통근·운전', work:'본업', ministry:'사역·예배', sleep:'수면' };
  const rows=[];
  for (const [s,e,t] of dayBlocks[day]) {
    if (t==='life') continue;
    if (t==='sleep') { if (s===0) rows.push({ s:e, e, type:'sleep', label:`기상 (약 ${e.toFixed(1)}h 수면)`, time:`~${fmtH(e)}` }); continue; }
    const hit = dayEv.find(x=>Math.abs(x.s-s)<0.6 || (x.s<=s+0.1 && x.e>=e-0.1));
    rows.push({ s,e,type:t, label: (t==='ministry'&&hit)?hit.t:lab[t], time:`${fmtH(s)}–${fmtH(e)}` });
  }
  return { day, rows };
}

// ---- auto insights + next-week recommendations ----
export function analyze(m, history) {
  const prev = history[history.length-1] || null;
  const ins = [], rec = [];
  const minTot = +(m.buckets.ministry + m.buckets.worship).toFixed(1);
  const k = KO[m.peakDay];

  // wins
  if (m.sleepByDay.sun >= 8) ins.push({ tone:'win', title:'토요일 1박이 수면을 지킴', detail:`일요일 아침 ${m.sleepByDay.sun}h 수면 — 한 주의 회복 지점이 살아있어요.` });
  ins.push({ tone:'win', title:'이동을 죽은 시간으로 두지 않음', detail:`주 ${m.drivingHours}h 운전의 절반은 학습, 절반은 통화로 환전 중.` });

  // watches
  if (m.restDays === 0) ins.push({ tone:'watch', title:`완전한 휴일 0일${m.zeroRestStreak>1?` · ${m.zeroRestStreak}주 연속`:''}`, detail:'일·통근·사역이 전혀 없는 날이 이번 주에도 없었어요.' });
  if (m.sleepMin < 5.6) ins.push({ tone:'watch', title:`최저 수면 ${m.sleepMin}h`, detail:'목요일 양평 일정 다음 날(금요일) 아침이 가장 짧게 눌립니다.' });
  if (prev && m.delta && m.delta.sleepAvg <= -0.2) ins.push({ tone:'watch', title:`수면 평균 ${Math.abs(m.delta.sleepAvg)}h 하락`, detail:`지난주 ${prev.sleepAvg}h → 이번주 ${m.sleepAvg}h.` });
  if (prev && m.delta && m.delta.ministry >= 3) ins.push({ tone:'watch', title:`사역 부하 +${m.delta.ministry}h`, detail:`이번 주 사역+예배 ${minTot}h로 평소보다 무거웠어요.` });
  if (m.buckets.exercise === 0) ins.push({ tone:'watch', title:'운동 0h', detail:'Work Out 캘린더가 이번 주에도 비어 있어요.' });

  // note
  ins.push({ tone:'note', title:`가장 긴 날: ${k}요일 ${m.peakCommitted}h`, detail: m.delta? `지난주 대비 ${m.delta.peakCommitted>0?'+':''}${m.delta.peakCommitted}h.`:'본업+이동+사역이 한 날에 몰린 지점.' });
  if (m.special.length) ins.push({ tone:'note', title:'이번 주 특이 일정', detail: m.special.map(s=>`${KO[s.day]} ${s.title}(${s.hours}h)`).join(', ') });

  // recommendations (prioritized)
  if (m.peakDay==='thu' || m.sleepMin<5.6) rec.push({ p:1, title:'목요일 밤, 양평 일찍 출발', detail:'연습을 30분 일찍 마치거나 목요일을 재택일로. 금요일 아침 수면부터 끊기.' });
  if (m.restDays===0) rec.push({ p: m.zeroRestStreak>=3?1:2, title:`다음 주 반나절 '완전한 휴일' 1개`, detail:`${m.zeroRestStreak>=3?`${m.zeroRestStreak}주 연속 0일 — `:''}일·사역·학습이 모두 0인 칸을 미리 비워두기.` });
  if (m.buckets.exercise===0) rec.push({ p:2, title:'운동을 동선에 얹기', detail:'양평 도착 후 10분 걷기부터. 빈 Work Out 캘린더 깨우기.' });
  if (m.buckets.selfcare===0) rec.push({ p:2, title:'회복 일정 1개 보호', detail:'로즈마리 같은 자기돌봄을 미팅에 밀리지 않는 약속으로 고정.' });
  if (m.special.length || minTot>=24) rec.push({ p:3, title:'악보·PPT 준비 한 타임에 모으기', detail:'목·주일 악보, YJDS·로고스 PPT를 묶어 전환 비용·밤작업 줄이기.' });
  rec.push({ p:3, title:'월–수 재택 저녁 중 하나 비우기', detail:'통근 없는 그 시간을 사역·학습으로 다 채우지 않기.' });
  rec.sort((a,b)=>a.p-b.p);

  return { insights: ins, recommendations: rec.slice(0,5) };
}
