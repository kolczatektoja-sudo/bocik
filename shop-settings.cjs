"use strict";

// Ustawienia sklepu (/cennik, nagrody za zaproszenia) w osobnym wierszu Supabase,
// żeby nie zależały od dużego stanu bota i przetrwały każdy restart.
const SHOP_SETTINGS_ROW_ID = 4;

const RATE_KEYS = [
  "anarchiaLifestealRate",
  "anarchiaLifestealBulkRate",
  "anarchiaLifestealBulkThresholdPln",
  "anarchiaBoxpvpRate",
  "minestarLfRate",
  "minestarLfBulkRate",
  "minestarLfBulkThresholdPln",
  "donutSmpRate",
  "minestarSkypvpRate",
];

function normalizeRates(value) {
  const rates = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return rates;
  for (const key of RATE_KEYS) {
    const number = Number(value[key]);
    if (Number.isFinite(number) && number > 0) rates[key] = number;
  }
  return rates;
}

function normalizeMilestones(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((milestone) => ({
      threshold: Math.floor(Number(milestone?.threshold)),
      amount: Math.floor(Number(milestone?.amount)),
      label: typeof milestone?.label === "string" ? milestone.label : "",
    }))
    .filter((milestone) => milestone.threshold > 0 && milestone.amount > 0)
    .map((milestone) => ({
      ...milestone,
      label: milestone.label || `${Math.round(milestone.amount / 1000)}k$`,
    }))
    .sort((a, b) => a.threshold - b.threshold);
}

function normalizeShopSettings(value) {
  return {
    calculatorRates: normalizeRates(value?.calculatorRates),
    inviteRewardMilestones: normalizeMilestones(value?.inviteRewardMilestones),
  };
}

/**
 * @param {{ load: () => Promise<object|null>, save: (data: object) => Promise<void> }} storage
 */
function createShopSettingsStore(storage) {
  return {
    async load() {
      return normalizeShopSettings(await storage.load());
    },
    async save(settings) {
      const data = { ...normalizeShopSettings(settings), savedAt: new Date().toISOString() };
      await storage.save(data);
      return data;
    },
  };
}

module.exports = {
  SHOP_SETTINGS_ROW_ID,
  RATE_KEYS,
  normalizeRates,
  normalizeMilestones,
  normalizeShopSettings,
  createShopSettingsStore,
};
