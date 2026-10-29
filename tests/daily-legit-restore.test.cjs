const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "index.cjs"), "utf8");
const start = source.indexOf("function parseDailyLegitMessage");
const end = source.indexOf("// Po resecie bota licznik", start);
const parseDailyLegitMessage = new Function(`${source.slice(start, end)}; return parseDailyLegitMessage;`)();

const summary = (date, total, pln) => ({
  id: "m" + date,
  createdTimestamp: 1,
  components: [{ content: "📊 New Shop × DZIENNE LC" }, {
    content: `> \`📅\` <a:a:1> **Data:** \`${date}\`\n> \`✅\` <a:a:1> **Wystawione legit checki:** \`${total}\`\n> \`💰\` <a:a:1> **Łączna wydana kwota:** \`${pln} PLN\``,
  }],
});

test("odczytuje datę, liczbę LC i kwotę z podsumowania dziennego", () => {
  assert.deepEqual(
    { ...parseDailyLegitMessage(summary("27.10.2026", 8, "315.00")) },
    { dateKey: "2026-10-27", total: 8, totalPln: 315, createdTimestamp: 1, messageId: "m27.10.2026" },
  );
});

test("ignoruje wiadomości, które nie są podsumowaniem dziennym", () => {
  assert.equal(parseDailyLegitMessage({ id: "x", components: [{ content: "REKORDY LC" }] }), null);
});

test("blokuje zapis do Supabase po nieudanym odczycie stanu", () => {
  assert.match(source, /if \(supabaseStateReadFailed\) \{/);
  assert.match(source, /supabaseStateReadFailed = true;/);
});

test("odtwarza rekordy ze starych podsumowań innego bota i bierze maksimum dnia", async () => {
  const restoreStart = source.indexOf("async function restoreDailyLegitFromChannel");
  const restoreEnd = source.indexOf("async function initializeDailyLegitChart", restoreStart);
  const dateStart = source.indexOf("function getWarsawDateParts");
  const dateEnd = source.indexOf("function createEmptyDailyLegitStats", dateStart);
  const state = {
    dailyLegitStats: { dateKey: "2026-10-29", hourly: Array(24).fill(0), total: 5, totalPln: 158, messageId: null },
    dailyLegitRecords: {},
    saved: 0,
  };
  const factory = new Function(
    "DAILY_LEGIT_TIME_ZONE", "client", "state", "scheduleSavePersistentState",
    `${source.slice(dateStart, dateEnd)}
     ${source.slice(source.indexOf("function parseDailyLegitMessage"), restoreEnd)}
     return async (channel) => {
       let dailyLegitStats = state.dailyLegitStats;
       const dailyLegitRecords = state.dailyLegitRecords;
       ${source.slice(restoreStart, restoreEnd).replace(/^async function restoreDailyLegitFromChannel\(channel\) \{/, "").replace(/\}\s*$/, "")}
     };`,
  );
  const restore = factory("Europe/Warsaw", { user: { id: "new-bot" } }, state, () => { state.saved++; });

  const msg = (id, date, total, pln, author = { id: "old-bot", bot: true }) => ({
    ...summary(date, total, pln), id, createdTimestamp: Date.parse("2026-10-20T12:00:00Z") + Number(id), author,
  });
  const messages = [
    msg("5", "29.10.2026", 5, "158.00"),
    msg("4", "28.10.2026", 8, "290.00"),
    msg("3", "27.10.2026", 6, "120.00"),
    msg("2", "27.10.2026", 8, "315.00"),
    { id: "1", author: { id: "human", bot: false }, components: [], createdTimestamp: 1 },
  ];
  const channel = {
    isTextBased: () => true,
    messages: {
      fetch: async () => {
        const batch = new Map(messages.map((m) => [m.id, m]));
        return { size: batch.size, values: () => batch.values(), last: () => messages.at(-1) };
      },
    },
  };

  await restore(channel);
  assert.deepEqual(state.dailyLegitRecords["2026-10-27"], { dateKey: "2026-10-27", total: 8, totalPln: 315 });
  assert.deepEqual(state.dailyLegitRecords["2026-10-28"], { dateKey: "2026-10-28", total: 8, totalPln: 290 });
  assert.equal(state.dailyLegitStats.total, 5);
  assert.equal(state.dailyLegitStats.messageId, "5");
  assert.ok(state.saved > 0);
});
