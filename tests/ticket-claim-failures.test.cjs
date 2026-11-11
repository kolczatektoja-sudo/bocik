const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

function fixture() {
  const locks = new Set(), calls = [];
  const context = vm.createContext({
    claimingInProgress: locks, ticketOwners: new Map(), MessageFlags: { Ephemeral: 64 },
    console: { error() {}, warn() {} },
    client: { channels: { async fetch() { calls.push('fetch'); throw new Error('unavailable channel'); } } },
  });
  const start = source.indexOf('async function ticketClaimCommon(');
  vm.runInContext(source.slice(start, source.indexOf('async function refreshTicketClaimStatistics(', start)), context);
  const interaction = {
    user: { id: 'seller' }, guild: { ownerId: 'owner' },
    isButton: () => true, deferred: false, replied: false,
    async deferUpdate() { calls.push('defer'); this.deferred = true; },
    async followUp(payload) { calls.push('followUp'); assert.match(payload.content, /Nie mogę znaleźć/); },
  };
  const claim = () => context.ticketClaimCommon(interaction, 'ticket', { skipQuiz: true, bypassPermissionCheck: true });
  return { calls, locks, interaction, claim, context };
}

test('failed rate-limited acknowledgement stops claim before channel access and releases lock', async () => {
  const f = fixture();
  f.interaction.deferUpdate = async () => {
    f.calls.push('defer');
    throw Object.assign(new Error('cooldown'), { localCooldown: true, status: 429 });
  };
  const result = await f.claim();
  assert.equal(result.reason, 'response-unavailable');
  assert.deepEqual(f.calls, ['defer']);
  assert.equal(f.locks.size, 0);
});

test('error reply helper remains available when claim fails after acknowledgement', async () => {
  const f = fixture();
  await f.claim();
  assert.deepEqual(f.calls, ['defer', 'fetch', 'followUp']);
  assert.equal(f.locks.size, 0);
});

test('unexpected failure reaches the catch reply helper without a ReferenceError', async () => {
  const f = fixture();
  f.context.ticketOwners.get = () => { throw new Error('unexpected failure'); };
  f.interaction.followUp = async payload => {
    f.calls.push('catch-reply');
    assert.match(payload.content, /Wystąpił błąd podczas przejmowania/);
  };
  const result = await f.claim();
  assert.equal(result.reason, 'error');
  assert.deepEqual(f.calls, ['defer', 'catch-reply']);
  assert.equal(f.locks.size, 0);
});
