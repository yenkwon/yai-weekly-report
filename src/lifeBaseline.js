import fs from 'node:fs';

export function loadLifeBaselines({ path }) {
  if (!path || !fs.existsSync(path)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(path, 'utf8'));
    return Array.isArray(rows) ? rows.filter((item) => item.active !== false) : [];
  } catch (error) {
    console.warn(`life baseline unavailable: ${error.message}`);
    return [];
  }
}

export function applyLifeBaselines(cfg, baselines = []) {
  const next = structuredClone(cfg);
  next.nonCalendarRoutines ||= [];

  for (const baseline of baselines) {
    for (const [index, block] of (baseline.proposal?.schedule_blocks || []).entries()) {
      const durationMinutes = blockDurationMinutes(block);
      if (!durationMinutes || !Array.isArray(block.days) || !block.days.length) continue;

      if (block.category === 'ministry' && block.days.includes('sun') && block.start && block.end) {
        next.routine.fixedMinistry.sunChurch.start = block.start;
        next.routine.fixedMinistry.sunChurch.end = block.end;
        continue;
      }
      if (block.category === 'commute' && block.days.includes('sun') && /양평/.test(String(block.from || ''))) {
        next.routine.fixedMinistry.sunChurch.driveHomeHours = durationMinutes / 60;
        continue;
      }
      if (block.category === 'commute' && block.days.includes('sat') && /양평/.test(String(block.to || ''))) {
        next.routine.commuteHours.gunpo_yangpyeong = durationMinutes / 60;
        continue;
      }

      const id = `${baseline.id || 'remembered'}-${index + 1}`;
      next.nonCalendarRoutines = [
        ...next.nonCalendarRoutines.filter((item) => item.id !== id),
        {
          id,
          title: block.title || baseline.proposal?.summary || '등록된 반복 일정',
          report_title: block.title || baseline.proposal?.summary || '등록된 반복 일정',
          category: block.category || 'life',
          days: block.days,
          duration_minutes: durationMinutes,
          active_from: String(baseline.confirmed_at || baseline.created_at || '').slice(0, 10) || undefined,
        },
      ];
    }
  }
  return next;
}

export function compactLifeBaselines(baselines = []) {
  return baselines.slice(0, 50).map((item) => ({
    id: item.id,
    kind: item.proposal?.kind || 'fact',
    summary: String(item.proposal?.summary || item.text || '').slice(0, 200),
  }));
}

function blockDurationMinutes(block) {
  const explicit = Number(block.duration_minutes);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  if (!block.start || !block.end) return 0;
  const [startHour, startMinute] = block.start.split(':').map(Number);
  const [endHour, endMinute] = block.end.split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return end >= start ? end - start : 24 * 60 - start + end;
}
