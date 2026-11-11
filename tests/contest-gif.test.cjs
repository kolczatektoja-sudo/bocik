const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { editContestWithGif, repairContestGifs } = require('../contest-gif.cjs');

function message(attachments = []) {
  return {
    author: { id: 'bot' },
    embeds: [{ description: 'Prize and participant count', color: 123 }],
    attachments: { find: fn => attachments.find(fn) },
    edits: [],
    async edit(payload) { this.edits.push(payload); },
  };
}

test('contest GIFs are shipped as valid animated GIF assets', () => {
  for (const name of ['standard (4).gif', 'standard (3).gif']) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'attached_assets', name));
    assert.match(bytes.subarray(0, 6).toString(), /^GIF8[79]a$/);
    assert.ok(bytes.includes(Buffer.from('NETSCAPE2.0')));
  }
});

test('restores missing GIF without changing contest text or buttons', async () => {
  const msg = message();
  const components = [{ custom_id: 'join' }];
  await editContestWithGif(msg, { components });
  assert.equal(msg.edits[0].embeds[0].description, msg.embeds[0].description);
  assert.equal(msg.edits[0].files[0].name, 'konkurs_start.gif');
  assert.equal(msg.edits[0].components, components);
  assert.equal(msg.edits[0].attachments, undefined);
});

test('participant update reuses existing GIF instead of uploading it again', async () => {
  const msg = message([{ name: 'konkurs_start.gif' }]);
  await editContestWithGif(msg, { embeds: [{ description: 'One participant' }] });
  assert.equal(msg.edits[0].files, undefined);
  assert.equal(msg.edits[0].attachments, undefined);
  assert.equal(msg.edits[0].embeds[0].description, 'One participant');
});

test('startup touches only active saved contests and skips healthy GIFs', async () => {
  const missing = message();
  const healthy = message([{ name: 'konkurs_start.gif' }]);
  healthy.embeds[0].image = { url: 'https://cdn.discordapp.com/gif' };
  const fetched = [];
  const client = { user: { id: 'bot' }, channels: { fetch: async () => ({
    messages: { fetch: async id => { fetched.push(id); return id === 'missing' ? missing : healthy; } },
  }) } };
  await repairContestGifs(client, new Map([
    ['expired', { endsAt: 0 }],
    ['missing', { endsAt: Date.now() + 60000 }],
    ['healthy', { endsAt: Date.now() + 60000 }],
  ]), { log() {}, error() {} });
  assert.deepEqual(fetched, ['missing', 'healthy']);
  assert.equal(missing.edits.length, 1);
  assert.equal(healthy.edits.length, 0);
});
