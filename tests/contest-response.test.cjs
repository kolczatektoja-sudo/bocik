const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

class Embed {
  setColor() { return this; }
  setDescription(text) { this.description = text; return this; }
  setTimestamp() { return this; }
}

function fixture(joined, failFetch = false) {
  let finishFetch;
  const slowFetch = new Promise(resolve => { finishFetch = resolve; });
  const responses = [], order = [];
  const participants = new Map(joined ? [['user', '']] : []);
  const context = vm.createContext({
    contests: new Map([['contest', { endsAt: Date.now() + 60000, channelId: 'channel' }]]),
    contestParticipants: new Map([['contest', participants]]),
    contestLeaveBlocks: new Map(), scheduleSavePersistentState() {},
    EmbedBuilder: Embed, COLOR_BLUE: 1, MessageFlags: { Ephemeral: 64 },
    console: { warn() {} },
    client: { channels: { fetch: async () => {
      order.push('panel-fetch');
      if (failFetch) throw new Error('Discord unavailable');
      await slowFetch;
      return null;
    } } },
  });
  for (const [name, next] of [
    ['handleKonkursJoinDirect', 'async function endContestByMessageId'],
    ['handleKonkursLeave', '// --- Obsługa anulowania opuszczenia konkursu ---'],
  ]) {
    const start = source.indexOf(`async function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf(next, start)), context);
  }
  const interaction = {
    user: { id: 'user' }, guild: { id: 'guild' },
    async reply(payload) { order.push('reply'); responses.push(payload); },
    async update(payload) { order.push('update'); responses.push(payload); },
  };
  return { context, interaction, order, responses, participants, finishFetch };
}

test('join confirms privately before an indefinitely slow public-panel fetch', async () => {
  const f = fixture(false);
  const pending = f.context.handleKonkursJoinDirect(f.interaction, 'contest');
  await Promise.resolve();
  assert.equal(f.order[0], 'reply');
  assert.equal(f.responses.length, 1);
  assert.deepEqual(Array.from(f.responses[0].flags), [64]);
  assert.match(f.responses[0].embeds[0].description, /Poprawnie dołączyłeś/);
  assert.equal(f.participants.has('user'), true);
  f.finishFetch();
  await pending;
  assert.equal(f.responses.length, 1);
});

test('leave updates the private confirmation before a slow public-panel fetch', async () => {
  const f = fixture(true);
  const pending = f.context.handleKonkursLeave(f.interaction, 'contest');
  await Promise.resolve();
  assert.equal(f.order[0], 'update');
  assert.match(f.responses[0].embeds[0].description, /Opuściłeś konkurs/);
  assert.equal(f.participants.has('user'), false);
  f.finishFetch();
  await pending;
  assert.equal(f.responses.length, 1);
});

test('failed public-panel requests do not lose or duplicate the user confirmation', async () => {
  for (const joined of [false, true]) {
    const f = fixture(joined, true);
    await f.context[joined ? 'handleKonkursLeave' : 'handleKonkursJoinDirect'](f.interaction, 'contest');
    assert.equal(f.responses.length, 1);
    assert.equal(f.participants.has('user'), !joined);
  }
});
