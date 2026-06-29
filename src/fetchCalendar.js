// fetchCalendar.js — pull last week's events from the calendars named in category-map.
// Auth: OAuth2 refresh token (GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN env vars).
import { google } from 'googleapis';

const DAY_BY_JS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function lastWeekRange(tz = 'Asia/Seoul', now = new Date()) {
  // Sunday evening sends report the current Monday-Sunday window; later runs use
  // the last fully closed Monday-Sunday window for corrections/re-sends.
  const todayLocal = dateKeyInTimeZone(now, tz);
  const daysSinceMonday = weekdayIndexMonday(todayLocal);
  const endLocal = daysSinceMonday === 6
    ? addDays(todayLocal, 1)
    : addDays(todayLocal, -daysSinceMonday);
  const startLocal = addDays(endLocal, -7);
  const endLocalInclusive = addDays(endLocal, -1);
  const week = reportWeekId(startLocal);
  const dateByDay = dateByDayForRange(startLocal);

  return {
    timeMin: zonedMidnight(startLocal, tz).toISOString(),
    timeMax: zonedMidnight(endLocal, tz).toISOString(),
    startLocal,
    endLocalExclusive: endLocal,
    endLocalInclusive,
    mondayLocal: dateByDay.mon,
    dateByDay,
    week,
    weekLabel: `${week} : ${formatMD(startLocal)} - ${formatMD(endLocalInclusive)}`,
  };
}

export async function fetchWeek(catmap, range) {
  requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'], 'Google Calendar');
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const cal = google.calendar({ version: 'v3', auth: oauth });

  const wanted = Object.keys(catmap.calendars);
  const { data } = await cal.calendarList.list({ maxResults: 250 });
  const targets = (data.items || []).filter(c =>
    wanted.some(n => (c.summary || '').includes(n)));

  const events = [];
  for (const c of targets) {
    const res = await cal.events.list({
      calendarId: c.id, timeMin: range.timeMin, timeMax: range.timeMax,
      singleEvents: true, orderBy: 'startTime', maxResults: 250,
    });
    for (const e of res.data.items || []) {
      if (!e.start?.dateTime) continue;             // skip all-day for hour math (handled separately if needed)
      events.push({ title: e.summary || '(제목 없음)', start: e.start.dateTime, end: e.end.dateTime, calendar: c.summary });
    }
  }
  return events;
}

function requireEnv(names, label) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`${label} is not configured. Missing env/secret: ${missing.join(', ')}`);
  }
}

function dateKeyInTimeZone(date, tz) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function weekdayIndexMonday(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedMidnight(dateKey, tz) {
  if (tz !== 'Asia/Seoul') {
    throw new Error(`Unsupported report timezone: ${tz}`);
  }
  return new Date(`${dateKey}T00:00:00+09:00`);
}

function dateByDayForRange(startLocal) {
  const result = {};
  for (let i = 0; i < 7; i++) {
    const date = addDays(startLocal, i);
    result[DAY_BY_JS[jsWeekdayIndex(date)]] = date;
  }
  return result;
}

function reportWeekId(startLocal) {
  const start = dateUTC(startLocal);
  const thursday = new Date(start);
  thursday.setUTCDate(start.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const firstMonday = firstIsoMonday(year);
  const week = Math.floor((start - firstMonday) / (7 * 864e5)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function firstIsoMonday(year) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  return jan4;
}

function dateUTC(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function jsWeekdayIndex(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function formatMD(dateKey) {
  return dateKey.slice(5).replace('-', '.');
}
