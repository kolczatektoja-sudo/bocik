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
