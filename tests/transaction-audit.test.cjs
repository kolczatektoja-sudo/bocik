const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransactionAudit, fromHumanRep, fromTranscript, normalizeRecord, money, payload } = require('../transaction-audit.cjs');
const buyer = '1305200545979437129', seller = '1449397101032112139', guild = '1350446732365926491';
const now = '2026-11-15T15:00:00.000Z';
const purchase = { id: 17, user_id: buyer, price: 25, type: 'zakup', server: 'Anarchia LF', created_at: now };
const message = { id: '1571279387137933323', guildId: guild, createdTimestamp: Date.parse(now),
  author: { id: buyer, username: 'client' }, content: `+rep <@${seller}> ZAKUP 25 PLN Anarchia LF`,
  url: `https://discord.com/channels/${guild}/1449840030947217529/1571279387137933323` };
const row = () => ({ key: 'ticket:1:interaction:staff', buyerId: buyer, guildId: guild, sellerId: seller,
  type: 'zakup', amount: '25 PLN', occurredAt: now, sourceUrl: message.url, sourceKind: 'staff-completion' });

test('money is exact in grosze and invalid/test/reward data never becomes a transaction', () => {
  assert.equal(money('12,34 PLN'), 1234);
  for (const v of ['-1', 'NaN', '0', '12.345', '1e10']) assert.equal(money(v), null);
  for (const extra of [{ isTest: true }, { synthetic: true }, { type: 'wręczył nagrodę' }, { buyerId: null }, { occurredAt: 'bad-date' }]) {
    assert.equal(normalizeRecord({ ...row(), ...extra }), null);
  }
});
test('human rep requires matching real-user database row; bot/webhook fake reps excluded', () => {
  const entry = fromHumanRep(message, [purchase]);
  assert.equal(entry.buyerId, buyer);
  assert.equal(entry.sellerId, seller);
  assert.equal(entry.paymentVerified, false);
  assert.equal(entry.originalPurchaseAt, now);
  assert.equal(fromHumanRep({ ...message, author: { ...message.author, bot: true } }, [purchase]), null);
  assert.equal(fromHumanRep({ ...message, webhookId: 'webhook' }, [purchase]), null);
  assert.equal(fromHumanRep(message, [{ ...purchase, user_id: seller }]), null);
  assert.equal(fromHumanRep(message, []), null);
  assert.equal(fromHumanRep(message, [{ ...purchase, price: 40 }]), null);
});
test('anonymous identity is recovered only from a linked ticket archive and purchase', () => {
  const text = `Channel ID: 1571279387137933324\nOpened by: ${buyer}\nClaimed by: ${seller}\nClose method: Automatyczne zamknięcie po anonimowym legit checku\n\n${message.content}`;
  const entry = fromTranscript(text, message, [purchase]);
  assert.equal(entry.buyerId, buyer);
  assert.equal(entry.amountCents, 2500);
  assert.match(entry.transcriptSha256, /^[a-f0-9]{64}$/);
  assert.equal(fromTranscript(message.content, message, [purchase]), null);
  assert.equal(fromTranscript(text, message, []), null);
  assert.equal(fromTranscript(text.replace(buyer, seller), message, [purchase]), null);
  assert.equal(fromTranscript(text + '\n+rep @other ZAKUP 40 PLN Anarchia LF', message, [purchase]), null);
});
test('log shows both identities, explicit evidence limitations and no notifications', () => {
  const output = payload(normalizeRecord(row()));
  assert.deepEqual(output.allowedMentions, { parse: [] });
  assert.ok(output.embeds[0].fields.some(f => f.value.includes(buyer)));
  assert.ok(output.embeds[0].fields.some(f => f.value.includes(seller)));
  assert.ok(output.embeds[0].fields.some(f => f.value.includes('Brak niezależnego potwierdzenia wpłaty')));
});
function fixture(initial) {
  let stored = initial, failLoad = false, failSave = false, failSend = false;
  const sent = new Map();
  let writes = 0;
  const channel = { client: { user: { id: seller } }, messages: {
    async fetch() { const m = new Map(sent); m.last = () => [...m.values()].at(-1); return m; },
  }, async send(data) {
    if (failSend) throw new Error('send-failed');
    const m = { id: String(sent.size + 1), author: { id: seller }, embeds: data.embeds };
    sent.set(m.id, m); return m;
  } };
  const storage = {
    load: async () => { if (failLoad) throw new Error('load-failed'); return stored && structuredClone(stored); },
    save: async data => { if (failSave) throw new Error('save-failed'); stored = structuredClone(data); writes++; },
    getChannel: async () => channel, getSources: async () => [], readPurchases: async () => [], sleep: async () => {},
  };
  return { make: () => createTransactionAudit(storage), sent, saved: () => stored, writes: () => writes,
    setLoadFail: x => failLoad = x, setSaveFail: x => failSave = x, setSendFail: x => failSend = x };
}
test('duplicate events, restart and send/save interruption never duplicate cards', async () => {
  const f = fixture(); let audit = f.make();
  assert.equal(await audit.record(row()), true);
  assert.equal(await audit.record(row()), false);
  await audit.run(); assert.equal(f.sent.size, 1);
  audit = f.make(); await audit.run(); assert.equal(f.sent.size, 1);
  const other = { ...row(), key: 'other' }; await audit.record(other);
  f.setSaveFail(true); await audit.run(); assert.equal(f.sent.size, 2);
  f.setSaveFail(false); audit = f.make(); await audit.run(); assert.equal(f.sent.size, 2);
});
test('failed read never overwrites ledger; retry preserves pending event', async () => {
  const f = fixture(); f.setLoadFail(true); const audit = f.make();
  await assert.rejects(audit.record(row())); assert.equal(f.writes(), 0);
  f.setLoadFail(false); await audit.run();
  assert.equal(audit.snapshot().records, 1); assert.equal(f.sent.size, 1);
});
test('occupied unrelated row is never overwritten and failed send keeps durable entry', async () => {
  const occupied = fixture({ kind: 'other-service' });
  await assert.rejects(occupied.make().record(row()), /AUDIT_ROW_OCCUPIED/); assert.equal(occupied.writes(), 0);
  const f = fixture(); const audit = f.make(); await audit.record(row()); f.setSendFail(true);
  await audit.run(); assert.equal(audit.snapshot().records, 1); assert.equal(audit.snapshot().published, 0);
  f.setSendFail(false); await audit.run(); assert.equal(audit.snapshot().published, 1);
});
test('read-only history import matches human evidence and never invokes source mutation', async () => {
  let saved;
  const source = { id: 'rep', client: { user: { id: seller } }, messages: {
    async fetch() { const batch = new Map([[message.id, message], ['fake', { ...message, id: 'fake', webhookId: 'anon' }]]); batch.last = () => message; return batch; },
    delete() { throw new Error('SOURCE DELETE FORBIDDEN'); },
    edit() { throw new Error('SOURCE EDIT FORBIDDEN'); },
  } };
  const audit = createTransactionAudit({ load: async () => saved, save: async data => { saved = data; },
    getSources: async () => [{ channel: source, kind: 'rep' }], readPurchases: async () => [purchase],
    getChannel: async () => ({ client: { user: { id: seller } }, messages: { fetch: async () => new Map() },
      send: async () => ({ id: 'published' }) }), sleep: async () => {} });
  await audit.run(); assert.equal(audit.snapshot().records, 1);
  assert.equal(audit.snapshot().history.rep.scanned, 2);
  assert.equal(audit.snapshot().history.rep.done, true);
  await audit.run(); assert.equal(audit.snapshot().records, 1);
});
