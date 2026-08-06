const SYSTEM = `너는 예은의 주간 생활 리포트를 쓰는 분석 파트너다.
입력의 숫자는 이미 코드가 계산했다. 숫자를 다시 계산하거나 추측하지 말고, 서로 다른 사실을 연결해 의미를 해석한다.
사역은 짐이 아니라 소명이라는 관점을 존중한다. 진단, 자책 유도, 뻔한 위로, 매주 반복되는 이동시간 조언은 쓰지 않는다.
최근 사용 주제와 표현을 보고 같은 이야기를 반복하지 않는다.
자기보고 원문을 직접 인용하거나 개인적인 세부를 재노출하지 말고, 체감의 패턴만 요약한다.
반드시 JSON 하나만 출력한다: {"opening_note":"1~2문장","integrated_insight":{"title":"짧은 제목","detail":"2~4문장"},"experiment":{"title":"행동 하나","detail":"검증할 관찰 기준을 포함한 1~2문장"}}`;

export async function synthesizeWeekly({ metrics, analysis, selfReports, history }) {
  const facts = buildFacts(metrics, analysis, selfReports, history);
  const fallback = fallbackSynthesis(metrics, analysis);
  if (!process.env.ANTHROPIC_API_KEY) return { ...fallback, source:'fallback' };
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-api-key':process.env.ANTHROPIC_API_KEY,
        'anthropic-version':'2023-06-01',
      },
      body:JSON.stringify({
        model:process.env.WEEKLY_MODEL || process.env.NOTE_MODEL || 'claude-sonnet-4-6',
        max_tokens:700,
        temperature:0.5,
        system:SYSTEM,
        messages:[{role:'user',content:`구조화된 이번 주 사실:\n${JSON.stringify(facts,null,2)}`}],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic ${response.status}`);
    const data = await response.json();
    const raw = (data.content||[]).filter((item)=>item.type==='text').map((item)=>item.text).join('').trim();
    const parsed = parseJson(raw);
    if (!valid(parsed)) throw new Error('Invalid synthesis JSON');
    return {
      openingNote:{text:parsed.opening_note.trim(),source:'llm'},
      integratedInsight:{...parsed.integrated_insight,source:'llm'},
      experiment:{p:1,...parsed.experiment,source:'llm'},
      source:'llm',
    };
  } catch (error) {
    console.warn(`weekly synthesis fallback: ${error.message}`);
    return { ...fallback, source:'fallback' };
  }
}

function buildFacts(m, analysis, selfReports, history) {
  return {
    sleep:{average:m.sleepAvg,minimum:m.sleepMin,known:m.sleepKnown,confidence:m.sleepKnown?'actual':'estimate'},
    changes:analysis.changes,
    selected_special_events:analysis.notableEvents,
    all_calendar_events:m.eventHistory,
    self_reports:selfReports,
    next_week:analysis.preview,
    candidate_experiment:analysis.experimentCandidate,
    recent_report_topics:history.slice(-4).map((row)=>({week:row.week,topics:row.insightTopics||[],insight:row.integratedInsight||null})),
    guardrails:['수면이 추정치면 회복 정도를 단정하지 않기','이동시간 역산 조언 반복 금지','변화와 특별 일정의 연결을 우선하기'],
  };
}

function fallbackSynthesis(m, analysis) {
  const change=analysis.changes[0]; const event=analysis.notableEvents.items[0];
  const concrete=event?`${event.title} — ${event.reasons.join(', ')}`:change?.title||'이번 주의 리듬';
  const confidence=m.sleepKnown?'실제 수면까지 확인된 해석입니다.':'수면은 추정치라 회복 여부는 판단하지 않았습니다.';
  return {
    openingNote:{text:`이번 주의 결을 바꾼 장면은 ${concrete}입니다. 숫자보다 달라진 맥락부터 살펴보세요.`,source:'fallback'},
    integratedInsight:{title:'달라진 일정이 만든 한 주',detail:`${change?.detail||'비교 기준을 쌓고 있습니다.'} ${event?`${event.title}의 영향과 함께 보면 변화의 이유가 더 선명합니다.`:''} ${confidence}`,source:'fallback'},
    experiment:{...analysis.experimentCandidate,source:'fallback'},
  };
}

function parseJson(raw) {
  const cleaned=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const start=cleaned.indexOf('{'); const end=cleaned.lastIndexOf('}');
  if(start<0||end<start)throw new Error('No JSON object');
  return JSON.parse(cleaned.slice(start,end+1));
}

function valid(value) {
  return Boolean(value?.opening_note && value?.integrated_insight?.title && value?.integrated_insight?.detail && value?.experiment?.title && value?.experiment?.detail);
}
