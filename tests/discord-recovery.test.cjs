const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordRecovery } = require('../discord-recovery.cjs');
const { createDiscordRateLimitGate } = require('../discord-rate-limit.cjs');

function fixture(probeImpl = async () => {}) {
  let time = 1000, count = 0;
  const jobs = new Map();
  const gate = createDiscordRateLimitGate({ now: () => time });
  const timers = {
    setTimeout(fn, delay) { const id = Symbol(); jobs.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
  };
  const monitor = createDiscordRecovery({ gate, timers, now: () => time,
    probe: async () => { count++; await probeImpl(gate); } });
  async function advance(ms) {
    time += ms;
    for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); await job.fn(); }
  }
  return { gate, monitor, advance, count: () => count, jobs };
}

test('recovery makes no request before Retry-After and probes once after expiry', async () => {
  const f = fixture();
  f.gate.block('bot-rest', 60000, 'ip');
  await f.advance(60000);
  assert.equal(f.count(), 0);
  await f.advance(101);
  assert.equal(f.count(), 1);
  assert.ok(f.monitor.snapshot().last_success_at);
  await f.advance(600000);
  assert.equal(f.count(), 1);
});

test('a newer server deadline replaces the scheduled probe', async () => {
  const f = fixture();
  f.gate.block('bot-rest', 60000, 'ip');
  await f.advance(10000);
  f.gate.block('bot-rest', 120000, 'ip');
  await f.advance(60001);
  assert.equal(f.count(), 0);
  await f.advance(60100);
  assert.equal(f.count(), 1);
});

test('restored cooldown schedules recovery without premature HTTP traffic', async () => {
  const f = fixture();
  f.gate.restoreState({ version: 1, ipUntil: 5000 });
  await f.advance(4000);
  assert.equal(f.count(), 0);
  await f.advance(101);
  assert.equal(f.count(), 1);
});

test('new 429 during recovery respects the next cooldown instead of retrying immediately', async () => {
  const f = fixture(async gate => {
    gate.block('bot-rest', 3600000, 'ip');
    throw Object.assign(new Error('limited'), { status: 429 });
  });
  f.gate.block('bot-rest', 1000, 'ip');
  await f.advance(1101);
  assert.equal(f.count(), 1);
  assert.equal(f.monitor.snapshot().last_error, '429');
  await f.advance(60000);
  assert.equal(f.count(), 1);
});

test('dispose cancels pending recovery', async () => {
  const f = fixture();
  f.gate.block('bot-rest', 1000, 'ip');
  f.monitor.dispose();
  await f.advance(2000);
  assert.equal(f.count(), 0);
});
