// fetchCalendar.js — pull last week's events from the calendars named in category-map.
// Auth: OAuth2 refresh token (GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN env vars).
import { google } from 'googleapis';

export function lastWeekRange(tz = 'Asia/Seoul', now = new Date()) {
  // Returns [Mon 00:00, next Mon 00:00) of the *just-finished* week (Sun report → previous Mon–Sun)
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const dow = (local.getDay() + 6) % 7;           // Mon=0
  const thisMon = new Date(local); thisMon.setHours(0,0,0,0); thisMon.setDate(local.getDate() - dow);
  const start = new Date(thisMon);                  // this week's Monday
  const end = new Date(thisMon); end.setDate(thisMon.getDate() + 7);
  const pad = (n)=>String(n).padStart(2,'0');
  const mondayLocal = `${thisMon.getFullYear()}-${pad(thisMon.getMonth()+1)}-${pad(thisMon.getDate())}`;
  return { timeMin: start.toISOString(), timeMax: end.toISOString(), mondayLocal };
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
