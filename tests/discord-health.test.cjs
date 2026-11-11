const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

function health(ready, retryAfter = 0, lastSuccess = '2026-11-11T20:00:00.000Z', lastLimitedAt = null) {
  let handler;
  const context = vm.createContext({
    app: { get: (_route, callback) => { handler = callback; } },
    client: { isReady: () => ready, ws: { ping: 42 } },
    discordRateLimit: { snapshot: () => ({ global_retry_after_ms: retryAfter, last_limited_at: lastLimitedAt }) },
    discordRestRecovery: { snapshot: () => ({ probe_scheduled: retryAfter > 0 }) },
    DISCORD_API_BASE: 'https://discord.com/api',
    ENABLE_HEAVY_STARTUP_SYNC: false,
    discordApplicationDiagnostic: {}, lastGatewayEventDiagnostic: {},
    lastDiscordLoginDiagnostic: {}, lastInteractionDiagnostic: {},
    lastSuccessfulInteractionResponseAt: lastSuccess,
    process: { env: {} },
  });
  const start = source.indexOf("app.get('/health',");
  const end = source.indexOf("app.get('/',", start);
  vm.runInContext(source.slice(start, end), context);
  const response = { headers: {}, set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  handler({}, response);
  return response;
}

test('external HTTP monitor detects disconnected Discord and recovers on reconnection', () => {
  const down = health(false);
  assert.equal(down.code, 503);
  assert.equal(down.body.discord_connected, false);
  assert.equal(down.headers['Cache-Control'], 'no-store');
  const up = health(true);
  assert.equal(up.code, 200);
  assert.equal(up.body.status, 'healthy');
});

test('temporary API cooldown remains visible without triggering hosting restart loops', () => {
  const limited = health(true, 60000);
  assert.equal(limited.code, 200);
  assert.equal(limited.body.status, 'degraded');
  assert.equal(limited.body.discord_rate_limit.global_retry_after_ms, 60000);
});

test('authenticated REST recovery never proves interaction callbacks recovered', () => {
  assert.equal(health(true, 0, null).body.status, 'awaiting_interaction');
  const stale = health(true, 0, '2026-11-11T19:00:00.000Z', '2026-11-11T19:20:00.000Z');
  assert.equal(stale.body.discord_interaction_response.verified_after_latest_limit, false);
  assert.equal(stale.body.status, 'awaiting_interaction');
});
