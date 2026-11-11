const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordRateLimitGate } = require('../discord-rate-limit.cjs');
const response = headers => ({ status: 429, headers: { get: name => headers[name] ?? null } });

test('absolute IP cooldown survives restart without extending the server deadline', () => {
  let now = 1000;
  const first = createDiscordRateLimitGate({ now: () => now });
  first.block('monitoring', 60000, 'ip');
  now = 11000;
  const restarted = createDiscordRateLimitGate({ now: () => now, initialState: first.exportState() });
  assert.equal(restarted.snapshot().ip_retry_after_ms, 50000);
  assert.throws(() => restarted.assertAllowed('bot-rest'));
  now = 61001;
  assert.doesNotThrow(() => restarted.assertAllowed('bot-rest'));
  const afterExpiry = createDiscordRateLimitGate({ now: () => now, initialState: first.exportState() });
  assert.equal(afterExpiry.snapshot().ip_retry_after_ms, 0);
});

test('restoring older state never clears or shortens a newer cooldown', () => {
  const gate = createDiscordRateLimitGate({ now: () => 1000 });
  gate.block('bot-rest', 10000, 'ip');
  gate.restoreState({ version: 1, ipUntil: 2000 });
  assert.equal(gate.snapshot().ip_retry_after_ms, 10000);
});

test('reported global block pauses every producer even without a retry_after field', () => {
  let now = 1000;
  const gate = createDiscordRateLimitGate({ now: () => now });
  gate.observe('interactions', response({}), { code: 0, message: 'You are being blocked from accessing our API temporarily due to exceeding global rate limits.' });
  for (const key of ['interactions', 'monitoring', 'bot-rest']) {
    assert.throws(() => gate.assertAllowed(key), error => error.status === 429 && error.localCooldown);
  }
  assert.equal(gate.snapshot().global_retry_after_ms, 60_000);
  now += 60_001;
  assert.doesNotThrow(() => gate.assertAllowed('interactions'));
});

test('Retry-After is respected, including fractional seconds and the longest header/body limit', () => {
  const gate = createDiscordRateLimitGate({ now: () => 0 });
  gate.observe('interactions', response({ 'retry-after': '5.5' }), { retry_after: 2, global: true });
  assert.equal(gate.snapshot().global_retry_after_ms, 5600);
});

test('a resource webhook limit does not block independent bot interactions', () => {
  const gate = createDiscordRateLimitGate();
  gate.observe('monitoring', response({}), { retry_after: 10, global: false });
  assert.throws(() => gate.assertAllowed('monitoring'));
  assert.doesNotThrow(() => gate.assertAllowed('interactions'));
});

test('a successful request cannot erase a previously imposed global wait', () => {
  const gate = createDiscordRateLimitGate({ now: () => 0 });
  gate.observe('interactions', response({}), { retry_after: 100, global: true });
  gate.observe('monitoring', { status: 200 }, {});
  gate.block('interactions', 1000, true);
  assert.equal(gate.snapshot().global_retry_after_ms, 100100);
});

test('SDK channel/category limits never freeze every bot request after the global wait ends', () => {
  let now = 1000;
  const gate = createDiscordRateLimitGate({ now: () => now });
  gate.block('bot-rest', 1000, true);
  gate.observe('bot-rest', response({ 'retry-after': '600', 'x-ratelimit-scope': 'shared' }), undefined, { globalOnly: true });
  now += 1001;
  assert.doesNotThrow(() => gate.assertAllowed('bot-rest'));
  assert.doesNotThrow(() => gate.assertAllowed('interaction-rest:interactions:42'));
});

test('global SDK limits still pause every producer', () => {
  const gate = createDiscordRateLimitGate();
  gate.observe('bot-rest', response({ 'retry-after': '60', 'x-ratelimit-global': 'true' }), undefined, { globalOnly: true });
  assert.throws(() => gate.assertAllowed('bot-rest'));
  assert.throws(() => gate.assertAllowed('monitoring'));
});

test('an individual interaction limit does not block a different interaction', () => {
  const gate = createDiscordRateLimitGate();
  gate.observe('interaction-rest:interactions:42', response({ 'retry-after': '10' }), { global: false });
  assert.throws(() => gate.assertAllowed('interaction-rest:interactions:42'));
  assert.doesNotThrow(() => gate.assertAllowed('interaction-rest:interactions:43'));
});

test('bot global wait does not block tokenless callbacks or monitoring', () => {
  const gate = createDiscordRateLimitGate({ now: () => 0 });
  gate.observe('bot-rest', response({ 'retry-after': '3092' }), { global: true });
  assert.throws(() => gate.assertAllowed('bot-rest'));
  gate.assertAllowed('interaction-rest:interactions:42', { authenticated: false });
  gate.assertAllowed('monitoring', { authenticated: false });
  assert.equal(gate.snapshot().ip_retry_after_ms, 0);
});

test('IP global limit from tokenless requests blocks both transports until expiry', () => {
  let now = 0;
  const gate = createDiscordRateLimitGate({ now: () => now });
  gate.observe('monitoring', response({ 'retry-after': '3092' }), { global: true }, { authenticated: false });
  assert.equal(gate.snapshot().ip_retry_after_ms, 3092100);
  assert.equal(gate.snapshot().bot_retry_after_ms, 0);
  assert.throws(() => gate.assertAllowed('bot-rest'));
  assert.throws(() => gate.assertAllowed('interaction-rest:interactions:42', { authenticated: false }));
  now = 3092101;
  gate.assertAllowed('bot-rest');
  gate.assertAllowed('interaction-rest:interactions:42', { authenticated: false });
});

test('temporary API ban applies even when body does not set global true', () => {
  const gate = createDiscordRateLimitGate({ now: () => 0 });
  gate.observe('bot-rest', response({ 'retry-after': '60' }),
    { global: false, message: 'You are being blocked from accessing our API temporarily due to exceeding global rate limits.' },
    { globalOnly: true });
  assert.throws(() => gate.assertAllowed('bot-rest'));
  assert.throws(() => gate.assertAllowed('interaction-rest:interactions:42', { authenticated: false }));
  assert.equal(gate.snapshot().ip_retry_after_ms, 60100);
});

test('tokenless route cooldown still applies during bot global exemption', () => {
  const gate = createDiscordRateLimitGate({ now: () => 0 });
  gate.block('bot-rest', 3000000, true);
  gate.observe('interaction-rest:interactions:42', response({ 'retry-after': '10' }), { global: false }, { authenticated: false });
  assert.throws(() => gate.assertAllowed('interaction-rest:interactions:42', { authenticated: false }));
  gate.assertAllowed('interaction-rest:interactions:43', { authenticated: false });
});
