// sendGuard.js — has this week's report already gone out?
//
// GitHub cron runs 2-5 hours late for this repo (Nov 2026), so an external
// scheduler dispatches `send` on time. A late scheduled run must not send the
// same week again. notify.js writes data/last-msg.json only after Telegram
// accepts the message.
import fs from 'node:fs';

export function alreadySentWeek(lastMsgPath, week) {
  try {
    return JSON.parse(fs.readFileSync(lastMsgPath, 'utf8')).week === week;
  } catch {
    return false;
  }
}
