import fs from 'node:fs';
import path from 'node:path';

const reportLabel = (report) => report.weekLabel || report.week;

export function summaryText(report, link) {
  const changes = (report.changes || []).slice(0, 3).map((item) => `• ${item.title} — ${item.detail}`);
  const special = report.notableEvents?.items?.[0];
  const experiment = report.recommendations?.[0];
  const lines = [
    report.openingNote.text,
    '',
    `⚖️ *${reportLabel(report)} 주간 리포트*`,
    '',
    '*이번 주 달라진 3가지*',
    ...changes,
    ...(special ? ['', `🗓 *특별 일정* ${special.title} — ${special.reasons.join(', ')}`] : []),
    '',
    `💡 *${report.integratedInsight.title}*`,
    report.integratedInsight.detail,
    ...(report.lifeContext?.present ? ['', `🌿 *생활 맥락* ${report.lifeContext.detail}`] : []),
    '',
    `📅 ${report.preview.title}: ${report.preview.detail}`,
    ...(experiment ? ['', `🧪 *다음 주 실험 하나* ${experiment.title}`, experiment.detail] : []),
    '',
    `📊 대시보드 → ${link}`,
  ];
  if (!report.sleepKnown) lines.push('', '💤 수면은 추정치라 회복 여부를 단정하지 않았어요. 실제 수면은 답장으로 숫자만 보내주세요.');
  return lines.join('\n');
}

export function renderHTML(report, templatePath = './templates/dashboard-v2.html') {
  const template = fs.readFileSync(templatePath, 'utf8');
  return template.replace('/*__WEEK_DATA__*/ null', serializeForScript(publicReport(report)));
}

export function publicReport(report) {
  const safe = structuredClone(report);
  delete safe.selfReports;
  delete safe.lifeContexts;
  delete safe.lifeContextRecent;
  delete safe.lifeBaselines;
  delete safe.rememberedBaselines;
  delete safe.eventHistory;
  delete safe.spotlight;
  delete safe.special;
  delete safe.dayBlocks;
  if (safe.subjective?.gap) {
    delete safe.subjective.gap.note;
    delete safe.subjective.gap.distance;
  }
  if (safe.lifeContext) {
    const { present, count, days, planCorrections, bodySignals, workSignals, themeCounts, topThemes, carriedCount, recentCount, recentDays, recentTopThemes, detail } = safe.lifeContext;
    safe.lifeContext = { present, count, days, planCorrections, bodySignals, workSignals, themeCounts, topThemes, carriedCount, recentCount, recentDays, recentTopThemes, detail };
  }
  if (safe.notableEvents?.items) {
    safe.notableEvents.items = safe.notableEvents.items.map(({ title, category, start, end, durationHours, allDay, periodEvent, day, reasons }) =>
      ({ title, category, start, end, durationHours, allDay, periodEvent, day, reasons }));
  }
  return safe;
}

function serializeForScript(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => ({
    '<':'\\u003c', '>':'\\u003e', '&':'\\u0026', '\u2028':'\\u2028', '\u2029':'\\u2029',
  }[char]));
}

export function appendHistory(historyPath, week, metrics, patch = {}) {
  const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : [];
  const row = {
    week,
    peakCommitted:metrics.peakCommitted,
    restDays:metrics.restDays,
    sleepAvg:metrics.sleepAvg,
    sleepMin:metrics.sleepMin,
    drivingHours:metrics.drivingHours,
    buckets:metrics.buckets,
    flags:metrics.flags,
    ...patch,
  };
  const index = history.findIndex((item) => item.week === week);
  if (index >= 0) history[index] = row;
  else history.push(row);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  return history;
}

export function appendPrivateEventHistory(historyPath, week, events) {
  const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : [];
  const row = { week, events:events || [] };
  const index = history.findIndex((item) => item.week === week);
  if (index >= 0) history[index] = row;
  else history.push(row);
  fs.mkdirSync(path.dirname(historyPath), { recursive:true });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  return history;
}
