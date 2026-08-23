// notify.js — send the message that `send`/`reconcile` parked earlier.
//
// Deliberately a separate entry point from index.js: that module fetches the
// calendar at import time, and this step must not need Google credentials or
// spend an API call just to post a message it already has.

import fs from 'node:fs';
import { sendReport, sendText } from './telegram.js';
import { waitForUrl } from './publish.js';

const PENDING_PATH = './data/pending-message.json';

if (!fs.existsSync(PENDING_PATH)) {
  console.log('nothing to notify');
  process.exit(0);
}

const pending = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
const result = await waitForUrl(pending.link);

if (result.live) {
  console.log('live', { status: result.status, waitedSec: Math.round(result.waitedMs / 1000), attempts: result.attempts });
} else {
  // Still send: a link that is briefly late beats no report at all.
  console.log(`::warning::${pending.link} still ${result.status} after ${Math.round(result.waitedMs / 1000)}s — sending anyway`);
}

if (pending.kind === 'send') {
  const msgId = await sendReport(pending.text);
  fs.writeFileSync('./data/last-msg.json', JSON.stringify({ week: pending.week, msgId }));
} else {
  await sendText(pending.text);
}

fs.rmSync(PENDING_PATH, { force: true });
console.log('sent', { kind: pending.kind, week: pending.week });
