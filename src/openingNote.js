// openingNote.js — the warm one-liner that opens the week.
// Quantitative analysis is always computed elsewhere; THIS adds the human voice.
// Uses Claude API (ANTHROPIC_API_KEY). Falls back to a varied, data-grounded line if absent.

const KO = { mon:'월',tue:'화',wed:'수',thu:'목',fri:'금',sat:'토',sun:'일' };

const VOICE = `너는 예은의 주간 워라밸 보고서를 여는 '한 줄'을 쓴다.
예은은 본업(세일즈포스 컨설턴트)에 더해 양평 교회에서 깊이 섬기는 사람이다. 사역은 짐이 아니라 소명이다.
규칙:
- 딱 1~3문장, 한국어. 그 주에 '실제로 있었던 가장 구체적인 디테일'을 최소 하나 물고 들어갈 것.
- 매주 톤을 바꿔라: 어떤 주는 코치처럼, 어떤 주는 담백하게, 무너진 주엔 살짝 따끔하게, 잘 버틴 주엔 따뜻하게. 뻔한 위로 금지.
- 진단 금지(번아웃이다 등). 자책 유도 금지. 사역의 의미를 존중하되 회복은 '걱정'이 아니라 '돌봄'으로 건넨다.
- "이번 주도 고생 많으셨죠" 같은 템플릿 문장 절대 금지.`;

function context(m, ins, selfReport) {
  const minTot = (m.buckets.ministry + m.buckets.worship).toFixed(0);
  const notes = (selfReport||[]).map(r => `${r.date}(${r.score??'-'}): ${r.note||''}`).join(' / ');
  const rd = ins.lenses.find(l=>l.key==='recovery_debt');
  return [
    `주차 발견: ${ins.discovery.title}`,
    `완전한 휴일 ${m.restDays}일(${m.zeroRestStreak}주 연속), 가장 긴 날 ${KO[m.peakDay]} ${m.peakCommitted}h`,
    `사역+예배 ${minTot}h, 수면 평균 ${m.sleepAvg}h(최저 ${m.sleepMin}h), 회복부채 누적 ${rd?.balance}h`,
    m.special?.length ? `특이 일정: ${m.special.map(s=>`${KO[s.day]} ${s.title}`).join(', ')}` : '',
    m.delta ? `지난주 대비 수면 ${m.delta.sleepAvg>=0?'+':''}${m.delta.sleepAvg}h, 사역 ${m.delta.ministry>=0?'+':''}${m.delta.ministry}h` : '',
    notes ? `자기보고 한 줄들: ${notes}` : '자기보고 없음',
  ].filter(Boolean).join('\n');
}

export async function openingNote(m, ins, selfReport) {
  const key = process.env.ANTHROPIC_API_KEY;
  const ctx = context(m, ins, selfReport);
  if (key) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{ 'content-type':'application/json', 'x-api-key':key, 'anthropic-version':'2023-06-01' },
        body: JSON.stringify({ model: process.env.NOTE_MODEL || 'claude-sonnet-4-6', max_tokens: 200,
          system: VOICE, messages:[{ role:'user', content:`이번 주 데이터:\n${ctx}\n\n여는 한 줄을 써줘.` }] }),
      });
      const j = await res.json();
      const txt = (j.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('').trim();
      if (txt) return { text: txt, source: 'llm' };
    } catch (e) { /* fall through */ }
  }
  return { text: fallback(m, ins), source: 'fallback' };
}

// Varied, data-grounded fallback (no API). Picks an angle by the week's shape + a concrete detail.
function fallback(m, ins) {
  const detail = m.special?.length ? `${KO[m.special[0].day]}요일 ${m.special[0].title}` : `${KO[m.peakDay]}요일의 긴 하루`;
  const rd = ins.lenses.find(l=>l.key==='recovery_debt');
  const worse = m.delta && m.delta.sleepAvg < -0.2;
  const better = m.delta && m.delta.sleepAvg > 0.2;
  const lines = [];
  if (worse) lines.push(`이번 주는 솔직히 더 무거웠어요 — 수면이 ${m.delta.sleepAvg}h 줄었네요. ${detail}을 또 해냈다는 것만 적어둘게요.`);
  if (better) lines.push(`지난주보다 숨통이 조금 트인 주였어요. 수면이 ${m.delta.sleepAvg>0?'+':''}${m.delta.sleepAvg}h. ${detail} 사이에서도 그걸 지켜낸 게 눈에 띄어요.`);
  if (m.flags.sundaySleep7) lines.push(`빈칸 없이 꽉 찬 한 주였지만, 일요일 아침 ${m.sleepByDay.sun}h 잠은 지켜냈네요. ${detail}을 통과한 사람에게 그건 작지 않아요.`);
  if (rd && rd.balance < -12) lines.push(`회복 잔고가 ${rd.balance}h까지 내려왔어요. ${detail}, 충분히 애썼어요 — 다음 주엔 반나절이라도 비울 수 있을지 같이 봐요.`);
  lines.push(`${detail}을 지나온 한 주. 숫자는 아래에 정리해뒀으니, 천천히 돌아봐요.`);
  return lines[Math.floor(Math.random()*Math.min(lines.length, lines.length))] || lines[lines.length-1];
}
