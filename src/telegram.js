// telegram.js — send the report (with force_reply for sleep) and read replies on reconcile.
const API = (t, m) => `https://api.telegram.org/bot${t}/${m}`;

export async function sendReport(text) {
  const r = await fetch(API(process.env.TELEGRAM_BOT_TOKEN, 'sendMessage'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown',
      disable_web_page_preview: false,
      reply_markup: { force_reply: true, input_field_placeholder: '예: 6.5 / 목5 금5.5' },
    }),
  });
  const j = await r.json();
  return j.result?.message_id;            // store this to detect the reply later
}

// On reconcile run: find a reply to our report message and parse a sleep override.
export async function readSleepReply(reportMsgId) {
  const r = await fetch(API(process.env.TELEGRAM_BOT_TOKEN, 'getUpdates') + '?offset=-20');
  const j = await r.json();
  const reply = (j.result || []).reverse().find(u =>
    u.message?.reply_to_message?.message_id === reportMsgId);
  if (!reply) return null;
  return parseSleep(reply.message.text);
}

// "6.5" → flat avg for all days; "목5 금5.5" → per-day override.
export function parseSleep(text = '') {
  const days = { '월':'mon','화':'tue','수':'wed','목':'thu','금':'fri','토':'sat','일':'sun' };
  const perDay = {};
  for (const mt of text.matchAll(/([월화수목금토일])\s*([0-9]+(?:\.[0-9]+)?)/g))
    perDay[days[mt[1]]] = parseFloat(mt[2]);
  if (Object.keys(perDay).length) return perDay;
  const flat = text.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (flat) { const v = parseFloat(flat[1]);
    return Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(d=>[d,v])); }
  return null;
}

export async function sendText(text) {
  await fetch(API(process.env.TELEGRAM_BOT_TOKEN, 'sendMessage'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text,
      parse_mode: 'Markdown', disable_web_page_preview: false }),
  });
}
