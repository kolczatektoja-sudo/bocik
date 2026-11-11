function createDiscordRecovery({ gate, probe, now = Date.now, timers = global }) {
  let timer = null, disposed = false, busy = false;
  let lastAttemptAt = null, lastSuccessAt = null, lastError = null;
  function arm(delay) {
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(check, Math.min(2147483647, Math.max(1, delay)));
    timer?.unref?.();
  }
  function schedule() {
    if (disposed) return;
    const wait = gate.snapshot().global_retry_after_ms;
    if (wait > 0) arm(wait + 100);
  }
  async function check(force = false) {
    timer = null;
    if (disposed || busy) return;
    if (!force && gate.snapshot().global_retry_after_ms > 0) { schedule(); return; }
    busy = true;
    lastAttemptAt = new Date(now()).toISOString();
    try {
      await probe();
      lastSuccessAt = new Date(now()).toISOString();
      lastError = null;
    } catch (error) {
      lastError = String(error?.code || error?.status || error?.name || 'network-error');
      // A new 429 uses the newly reported deadline; network failures wait a minute.
      if (gate.snapshot().global_retry_after_ms > 0) schedule();
      else if (!disposed) arm(60000);
    } finally { busy = false; }
  }
  const unsubscribe = gate.subscribe(schedule);
  schedule();
  return {
    snapshot() { return { last_attempt_at: lastAttemptAt, last_success_at: lastSuccessAt,
      last_error: lastError, probe_running: busy, probe_scheduled: timer !== null }; },
    probeNow() { return check(true); },
    dispose() { disposed = true; unsubscribe(); if (timer !== null) timers.clearTimeout(timer); timer = null; },
  };
}
module.exports = { createDiscordRecovery };
