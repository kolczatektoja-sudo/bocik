const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { helperMayViewTicket } = require("../ticket-access.cjs");

test("helper widzi tickety z nagrodami i pytania", () => {
  assert.equal(helperMayViewTicket({ ticketType: "odbior-nagrody" }), true);
  assert.equal(helperMayViewTicket({ label: "NAGRODA" }), true);
  assert.equal(helperMayViewTicket({ ticketType: "inne" }), true);
  assert.equal(helperMayViewTicket({ label: "PYTANIE" }), true);
});

test("helper nadal nie widzi ticketów zakupowych ani sprzedażowych", () => {
  for (const ticketType of ["zakup", "sprzedaz", "ticket-100-200", undefined]) {
    assert.equal(helperMayViewTicket({ ticketType }), false, String(ticketType));
  }
  assert.equal(helperMayViewTicket({ label: "ZAKUP" }), false);
  assert.equal(helperMayViewTicket(), false);
});

test("żadne miejsce w bocie nie odbiera już helperowi ticketów nagród na sztywno", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.cjs"), "utf8");
  // Każde nadanie uprawnień helperowi ma przechodzić przez helperMayViewTicket.
  const hardDenies = source.match(/id: "1519069239254974475",\s*\n\s*deny: \[PermissionsBitField\.Flags\.ViewChannel\],/g) || [];
  assert.equal(hardDenies.length, 0);
  assert.match(source, /helperMayViewTicket/);
});
