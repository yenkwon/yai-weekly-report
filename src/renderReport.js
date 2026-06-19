import fs from 'node:fs';
const KO = { mon:'월',tue:'화',wed:'수',thu:'목',fri:'금',sat:'토',sun:'일' };

export function summaryText(r, link) {
  const minTot = (r.buckets.ministry + r.buckets.worship).toFixed(1);
  const rd = r.lenses.find(l=>l.key==='recovery_debt');
  const lines = [
    r.openingNote.text, '',
    `🗓️ *${r.week} 워라밸 보고*`,
    `• ${r.discovery.title}`,
    `• 완전한 휴일 *${r.restDays}일*${r.zeroRestStreak>1?` (${r.zeroRestStreak}주 연속)`:''} · 가장 긴 날 ${KO[r.peakDay]} ${r.peakCommitted}h`,
    `• 사역+예배 ${minTot}h · 타인 ${r.lenses.find(l=>l.key==='others_self').othersPct}% / 나 ${r.lenses.find(l=>l.key==='others_self').selfPct}%`,
    `• 수면 평균 *${r.sleepAvg}h*${r.sleepKnown?' ✅실측':' (추정)'} · 회복부채 ${rd.balance}h`,
    `• ${r.preview.title}: ${r.preview.flags.length?r.preview.flags[0]:'큰 충돌 없음'}`,
    '', `📊 대시보드 → ${link}`,
  ];
  if (!r.sleepKnown) lines.push('', '💤 실제 수면이 달랐다면 *답장으로 숫자*만 (예: 6.5 / "목5 금5.5").');
  return lines.join('\n');
}

export function renderHTML(report, templatePath = './templates/dashboard.html') {
  return fs.readFileSync(templatePath,'utf8').replace('/*__WEEK_DATA__*/ null', JSON.stringify(report));
}

export function appendHistory(historyPath, week, m, patch={}) {
  const h = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath,'utf8')) : [];
  const row = { week, peakCommitted:m.peakCommitted, restDays:m.restDays, sleepAvg:m.sleepAvg,
    sleepMin:m.sleepMin, drivingHours:m.drivingHours, buckets:m.buckets, flags:m.flags, ...patch };
  const i = h.findIndex(x=>x.week===week); if (i>=0) h[i]=row; else h.push(row);
  fs.writeFileSync(historyPath, JSON.stringify(h,null,2));
  return h;
}
