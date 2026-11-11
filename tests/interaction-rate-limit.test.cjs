const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDiscordRateLimitGate } = require('../discord-rate-limit.cjs');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

function fixture(sdk) {
  const gate = createDiscordRateLimitGate({ now: () => 0 });
  const calls = [];
  const listeners = {};
  const client = { rest: { on(event, listener) { listeners[event] = listener; } } };
  for (const method of ['post', 'patch', 'delete', 'put']) {
    client.rest[method] = async (route, options) => {
      calls.push({ method, transport: 'sdk', route });
      return sdk?.[method](route, options);
    };
  }
  const context = vm.createContext({
    client, discordRateLimit: gate, AbortController, AbortSignal, URL, URLSearchParams, setTimeout, clearTimeout,
    lastSuccessfulInteractionResponseAt: null,
    DISCORD_API_BASE: 'https://discord.com/api', console: { warn() {} },
    fetch: async (url, options) => {
      calls.push({ method: options.method, transport: 'direct', url });
      return { ok: true, text: async () => '' };
    },
  });
  const start = source.indexOf('function isInteractionResponseRoute(');
  const end = source.indexOf('trackDiscordRestRateLimits(client.rest);', start);
  vm.runInContext(source.slice(start, end), context);
  context.trackDiscordRestRateLimits(client.rest);
  return { gate, calls, client, context, listeners };
}

test('showModal/replies and multipart interaction routes survive bot-only cooldown', async () => {
  const f = fixture();
  f.gate.block('bot-rest', 3092822, true);
  await f.client.rest.post('/interactions/123/token/callback', { body: { type: 9 } });
  await f.client.rest.patch('/webhooks/456/token/messages/@original', { body: { content: 'reply' } });
  await f.client.rest.post('/interactions/124/token/callback', { files: [{}] });
  await assert.rejects(f.client.rest.post('/channels/789/messages', {}), { localCooldown: true });
  assert.deepEqual(f.calls.map(call => call.transport), ['sdk', 'sdk', 'sdk']);
});

test('real SDK rejects a callback 429 once, preserves delay and sanitizes token URLs', async () => {
  const { REST } = require('discord.js');
  let requests = 0;
  const sdk = new REST({
    rejectOnRateLimit: ['/interactions', '/webhooks'],
    async makeRequest() {
      requests++;
      return new Response(JSON.stringify({ retry_after: 3600 }), {
        status: 429, headers: { 'retry-after': '3600', 'content-type': 'application/json' },
      });
    },
  });
  const f = fixture(sdk);
  await assert.rejects(f.client.rest.post('/interactions/123/SECRET_TOKEN/callback', {
    auth: false, body: { type: 4, data: { content: 'test' } },
  }), error => error.status === 429 && error.retryAfterMs >= 3600000 && !String(error).includes('SECRET_TOKEN'));
  assert.equal(requests, 1);
  await assert.rejects(f.client.rest.post('/interactions/123/SECRET_TOKEN/callback', { auth: false }), { localCooldown: true });
  assert.equal(requests, 1);
});

test('IP cooldown stops all interaction transports before sending a request', async () => {
  const f = fixture();
  f.gate.block('monitoring', 3092822, 'ip');
  for (const options of [{ body: { type: 9 } }, { files: [{}] }]) {
    await assert.rejects(f.client.rest.post('/interactions/123/token/callback', options), { localCooldown: true });
  }
  assert.equal(f.calls.length, 0);
});

test('SDK tokenless global response records IP wait; shared channel wait stays local', async () => {
  const f = fixture();
  await f.listeners.response({ path: '/channels/123', data: { auth: true } }, new Response(
    JSON.stringify({ global: false, retry_after: 3000 }),
    { status: 429, headers: { 'retry-after': '3000', 'x-ratelimit-scope': 'shared' } }));
  assert.equal(f.gate.snapshot().global_retry_after_ms, 0);
  await f.listeners.response({ path: '/interactions/123/token/callback', data: { auth: false } }, new Response(
    JSON.stringify({ global: true, retry_after: 3000 }),
    { status: 429, headers: { 'retry-after': '3000', 'x-ratelimit-global': 'true' } }));
  assert.equal(f.gate.snapshot().ip_retry_after_ms, 3000100);
  assert.throws(() => f.gate.assertAllowed('bot-rest'));
});
