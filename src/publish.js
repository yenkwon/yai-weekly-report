// Wait for a published page to actually be reachable.
//
// The workflow sends the Telegram message from a different step than the one
// that pushes docs/, and GitHub Pages still has to build after that push. The
// link therefore used to go out pointing at a page that did not exist yet, and
// clicking it immediately gave a 404 for a minute or more.
//
// Polls the bare URL — the exact one the reader will click — so a 200 here
// means a 200 for them, CDN cache included.

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForUrl(url, options = {}) {
  const {
    timeoutMs = 5 * 60_000,
    intervalMs = 10_000,
    fetchImpl = fetch,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = options;

  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let attempts = 0;
  let lastStatus = null;

  for (;;) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, { redirect: 'follow' });
      lastStatus = response.status;
      if (response.ok) return { live: true, status: response.status, attempts, waitedMs: now() - startedAt };
    } catch (error) {
      lastStatus = error?.message || String(error);
    }
    if (now() + intervalMs > deadline) {
      return { live: false, status: lastStatus, attempts, waitedMs: now() - startedAt };
    }
    await sleep(intervalMs);
  }
}
