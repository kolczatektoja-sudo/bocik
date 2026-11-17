const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const parserStart = source.indexOf('function parseSaleAmount(');
const parserEnd = source.indexOf('async function handleModalSubmit(', parserStart);
const parser = source.slice(parserStart, parserEnd);
const handlers = [...source.matchAll(/  if \((?:id|rawCid) === "modal_rozliczenie_dodaj"\) \{/g)]
  .map(match => {
    const end = source.indexOf('\n  if (', match.index + match[0].length);
    return source.slice(match.index, end);
  });

function fixture(handler) {
  const saved = [];
  const messages = [];
  const replies = [];
  const weeklySales = new Map([['seller', { amount: 0.1, paid: false }]]);
  class Embed {
    setColor() { return this; }
    setTitle() { return this; }
    setDescription(value) { this.description = value; return this; }
  }
  const context = vm.createContext({
    nextWeekSales: new Map(), rolloverSettlementCycle: async () => {}, isSettlementCutActive: () => false,
    weeklySales, EmbedBuilder: Embed, COLOR_BLUE: 0, ROZLICZENIA_PROWIZJA: 0.1,
    MessageFlags: { Ephemeral: 64 },
    db: { saveWeeklySale: async (...args) => saved.push(args) },
    findGuildEmojiByName: () => null, scheduleSavePersistentState() {},
    setTimeout() {}, sendRozliczeniaMessage() {}, sendRozliczeniaStatusReport() {},
  });
  const settlement = source.slice(source.indexOf('async function addSaleToSettlement('), source.indexOf('async function sendRozliczeniaStatusReport('));
  vm.runInContext(parser + settlement + `\nasync function submit(interaction) {
    const id = interaction.customId;
    const rawCid = interaction.customId;
    ${handler}
  }`, context);
  const submit = async raw => context.submit({
    customId: 'modal_rozliczenie_dodaj', user: { id: 'seller' }, guild: { id: 'guild' },
    fields: { getTextInputValue: () => raw },
    channel: { send: async payload => messages.push(payload) },
    reply: async payload => replies.push(payload),
    deferReply: async () => {}, deleteReply: async () => {},
  });
  return { submit, saved, messages, replies, weeklySales };
}

test('both sale modal implementations are covered', () => {
  assert.equal(handlers.length, 2);
});

handlers.forEach((handler, index) => {
  test(`sale handler ${index + 1} saves decimal amounts and displays the correct weekly total`, async () => {
    const f = fixture(handler);
    for (const [raw, expected] of [['10,5', 10.6], ['10.5', 21.1], ['0,20', 21.3], ['50', 71.3], [' 10.05 ', 81.35]]) {
      await f.submit(raw);
      assert.equal(f.saved.at(-1)[1], expected, raw);
      assert.equal(f.weeklySales.get('seller').amount, expected, raw);
      assert.ok(f.messages.at(-1).embeds[0].description.includes(expected.toLocaleString('pl-PL') + ' zł'));
    }
    assert.ok(f.messages[0].embeds[0].description.includes('10,5 zł'));
  });

  test(`sale handler ${index + 1} rejects invalid input without saving a sale`, async () => {
    const f = fixture(handler);
    for (const raw of ['', '0', '-10.5', '10,5,0', '10.5.0', '10,500', 'abc105', '10,5 zł', 'Infinity', '1e3']) {
      await f.submit(raw);
    }
    assert.equal(f.replies.length, 10);
    assert.equal(f.saved.length, 0);
    assert.equal(f.messages.length, 0);
    assert.equal(f.weeklySales.get('seller').amount, 0.1);
  });
});
