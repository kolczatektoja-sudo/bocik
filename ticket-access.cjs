"use strict";

// Które tickety może otwierać i obsługiwać rola helpera.
// Do tej pory były to wyłącznie pytania ("inne"); tickety z nagrodami były przed helperem ukryte.
const HELPER_TICKET_TYPES = new Set(["inne", "odbior-nagrody"]);
const HELPER_TICKET_LABELS = new Set(["PYTANIE", "NAGRODA"]);

function helperMayViewTicket({ ticketType, label } = {}) {
  return HELPER_TICKET_TYPES.has(ticketType) || HELPER_TICKET_LABELS.has(label);
}

module.exports = { helperMayViewTicket, HELPER_TICKET_TYPES, HELPER_TICKET_LABELS };
