// fetchCalendar.js — pull last week's events from the calendars named in category-map.
// Auth: OAuth2 refresh token (GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN env vars).
import { google } from 'googleapis';

export function lastWeekRange(tz = 'Asia/Seoul', now = new Date()) {
  // Returns [Mon 00:00, next Mon 00:00) of the *just-finished* week (Sun report → previous Mon–Sun)
  const todayLocal = dateKeyInTimeZone(now, tz);
  const dow = weekdayIndex(todayLocal);           // Mon=0
  const mondayLocal = addDays(todayLocal, -dow);
  const nextMondayLocal = addDays(mondayLocal, 7);
  return {
    timeMin: zonedMidnight(mondayLocal, tz).toISOString(),
    timeMax: zonedMidnight(nextMondayLocal, tz).toISOString(),
    mondayLocal,
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

function weekdayIndex(dateKey) {
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
