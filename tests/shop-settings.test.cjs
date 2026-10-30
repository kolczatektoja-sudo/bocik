const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createShopSettingsStore,
  normalizeRates,
  normalizeMilestones,
} = require("../shop-settings.cjs");

test("zapisane stawki /cennik i nagrody za zaproszenia wracają po restarcie", async () => {
  let row = null;
  const store = createShopSettingsStore({
    load: async () => row,
    save: async (data) => { row = JSON.parse(JSON.stringify(data)); },
  });
  await store.save({
    calculatorRates: { anarchiaLifestealRate: 9000, donutSmpRate: 6_000_000 },
    inviteRewardMilestones: [
      { threshold: 10, amount: 250000, label: "250k$" },
      { threshold: 5, amount: 100000, label: "100k$" },
    ],
  });
  const loaded = await store.load();
  assert.deepEqual(loaded.calculatorRates, { anarchiaLifestealRate: 9000, donutSmpRate: 6_000_000 });
  assert.deepEqual(loaded.inviteRewardMilestones.map((m) => [m.threshold, m.amount, m.label]),
    [[5, 100000, "100k$"], [10, 250000, "250k$"]]);
});

test("pusty wiersz nie nadpisuje ustawień domyślnych", async () => {
  const store = createShopSettingsStore({ load: async () => null, save: async () => {} });
  assert.deepEqual(await store.load(), { calculatorRates: {}, inviteRewardMilestones: [] });
});

test("odrzuca błędne stawki i nieznane klucze", () => {
  assert.deepEqual(normalizeRates({ anarchiaLifestealRate: -1, minestarLfRate: "300", hack: 5, donutSmpRate: NaN }),
    { minestarLfRate: 300 });
});

test("uzupełnia brakującą etykietę nagrody i odrzuca złe progi", () => {
  assert.deepEqual(normalizeMilestones([{ threshold: 5, amount: 90000 }, { threshold: 0, amount: 1 }]),
    [{ threshold: 5, amount: 90000, label: "90k$" }]);
});
