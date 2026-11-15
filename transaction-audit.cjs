'use strict';
const { createHash } = require('node:crypto');
const AUDIT_CHANNEL_ID = '1571279387137933322';
const AUDIT_ROW_ID = 6;
const GUILD_ID = '1350446732365926491';
const OWNER_ID = '1305200545979437129';
const id = value => /^\d{16,22}$/.test(String(value || '')) ? String(value) : null;
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const cut = (value, n = 900) => String(value || 'nie zapisano').slice(0, n);
function reportRecord(entry) {
  const { messageId, ...record } = entry;
  return { ...record, partyRole: record.buyerId === OWNER_ID ? 'właściciel / wpis wewnętrzny' : 'klient' };
}
function csv(entries) {
  const columns = [
    ['ID wpisu','key'], ['ID transakcji','transactionId'], ['ID rekordu bazy','purchaseId'], ['Rola użytkownika','partyRole'],
    ['ID użytkownika','buyerId'], ['Użytkownik','buyerName'], ['ID obsługi','sellerId'], ['Obsługa','sellerName'],
    ['Typ','type'], ['Kwota PLN',e => (e.amountCents / 100).toFixed(2).replace('.',',')],
    ['Data zdarzenia UTC','occurredAt'], ['Data zapisania UTC','recordedAt'], ['Serwer','server'],
    ['Metoda płatności z ticketu','paymentMethod'], ['Źródło','sourceUrl'], ['Opis źródła','evidence'],
    ['Wpłata niezależnie zweryfikowana',() => 'NIE'],
  ];
  const cell = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r\n]/.test(text) || /^\d{16,}$/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + [columns.map(c => cell(c[0])).join(';'), ...entries.map(e =>
    columns.map(c => cell(typeof c[1] === 'function' ? c[1](e) : e[c[1]])).join(';'))].join('\r\n');
}
function money(value) {
  const match = String(value ?? '').replace(/\s/g, '').match(/^(\d+)(?:[.,](\d{1,2}))?(?:PLN|zł)?$/i);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
function transactionType(value) {
  const type = norm(value);
  return type === 'zakup' ? 'zakup' : type === 'sprzedaz' || type === 'sprzedaż' ? 'sprzedaz' : null;
}
function parseRep(content) {
  const m = String(content || '').trim().match(/^\+rep\s+(<@!?(\d+)>|@\S+)\s+(ZAKUP|SPRZEDAŻ|SPRZEDAZ)\s+(\d+(?:[.,]\d{1,2})?)\s+PLN\s+(.+)$/iu);
  return m ? { sellerId: id(m[2]), type: transactionType(m[3]), amountCents: money(m[4]), server: m[5].trim() } : null;
}
function normalizeRecord(raw) {
  if (!raw || raw.isTest || raw.synthetic || !id(raw.buyerId) || !id(raw.guildId)) return null;
  const type = transactionType(raw.type), amountCents = raw.amountCents ?? money(raw.amount);
  if (!type || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !raw.key || !raw.sourceUrl) return null;
  if (!Number.isFinite(Date.parse(raw.occurredAt))) return null;
  const occurredAt = new Date(raw.occurredAt).toISOString();
  return { ...raw, type, amountCents, occurredAt, recordedAt: new Date().toISOString(), paymentVerified: false };
}
function matchPurchase(rows, evidence) {
  const candidates = rows.filter(row => String(row.user_id) === evidence.buyerId &&
    transactionType(row.type) === evidence.type && money(row.price) === evidence.amountCents &&
    norm(row.server) === norm(evidence.server) &&
    Math.abs(Date.parse(row.created_at) - Date.parse(evidence.occurredAt)) <= 7 * 86400000);
  candidates.sort((a, b) => Math.abs(Date.parse(a.created_at) - Date.parse(evidence.occurredAt)) -
    Math.abs(Date.parse(b.created_at) - Date.parse(evidence.occurredAt)));
  // Ambiguous historical matches are excluded rather than assigning an identity by guesswork.
  if (!candidates.length || candidates[1] && candidates[0].created_at === candidates[1].created_at) return null;
  return candidates[0];
}
function fromHumanRep(message, rows) {
  if (message.author?.bot || message.webhookId || !id(message.author?.id)) return null;
  const parsed = parseRep(message.content);
  if (!parsed) return null;
  const evidence = { ...parsed, buyerId: message.author.id, occurredAt: new Date(message.createdTimestamp).toISOString() };
  const purchase = matchPurchase(rows, evidence);
  if (!purchase?.id) return null;
  return normalizeRecord({ ...evidence, key: `history:purchase:${purchase.id}`, guildId: message.guildId,
    buyerName: message.author.tag || message.author.username, sourceKind: 'history-customer-rep',
    sourceUrl: message.url, sourceMessageId: message.id, purchaseId: String(purchase.id),
    evidence: 'Wiadomość klienta +rep zgodna z zapisem user_purchases. Nie weryfikowano płatności.',
    originalPurchaseAt: purchase.created_at });
}
function fromPurchase(row, cutoff) {
  if (!row?.id || !id(row.user_id) || Date.parse(row.created_at) > Date.parse(cutoff)) return null;
  return normalizeRecord({ key: `history:purchase:${row.id}`, guildId: row.guild_id, buyerId: row.user_id,
    type: row.type, amount: row.price, server: row.server, occurredAt: row.created_at,
    originalPurchaseAt: row.created_at, purchaseId: String(row.id), sourceKind: 'history-database',
    sourceUrl: `Baza user_purchases — rekord ID ${row.id}`,
    evidence: 'Historyczny zapis realizacji z /ticket-zakoncz: ID klienta, kwota i data pochodzą z bazy. Brak zachowanego powiązania z publicznym +rep; nie weryfikowano płatności.' });
}
function fromTranscript(text, message, rows) {
  const buyerId = id(text.match(/^Opened by: (\d+)$/m)?.[1]);
  const ticketId = id(text.match(/^Channel ID: (\d+)$/m)?.[1]);
  const method = text.match(/^Close method: (.+)$/m)?.[1] || '';
  if (!buyerId || !ticketId || !/^Automatyczne zamknięcie po (?:anonimowym legit checku|\+rep)$/.test(method)) return null;
  const unique = new Map();
  for (const line of text.split('\n')) {
    const rep = parseRep(line);
    if (rep) unique.set(JSON.stringify(rep), rep);
  }
  if (unique.size !== 1) return null;
  const rep = [...unique.values()][0];
  const evidence = { ...rep, buyerId, occurredAt: message.embeds?.[0]?.timestamp || new Date(message.createdTimestamp).toISOString() };
  const purchase = matchPurchase(rows, evidence);
  const sellerId = rep.sellerId || id(text.match(/^Claimed by: (\d+)$/m)?.[1]);
  return normalizeRecord({ ...evidence, key: purchase?.id ? `history:purchase:${purchase.id}` : `history:ticket:${ticketId}`, guildId: message.guildId,
    sellerId, ticketId, purchaseId: purchase?.id ? String(purchase.id) : null, sourceKind: 'history-ticket-archive',
    sourceUrl: message.url, sourceMessageId: message.id, originalPurchaseAt: purchase?.created_at || null,
    transcriptSha256: createHash('sha256').update(text).digest('hex'),
    evidence: `Archiwum ticketu${purchase?.id ? ' + zgodny zapis historii zakupów' : '; brak dopasowanego rekordu w zachowanej bazie'}. ${method}. Tożsamość i kwota pochodzą z ticketu; nie weryfikowano płatności.` });
}
function payload(record) {
  const user = (uid, name) => uid ? `<@${uid}>\nID: \`${uid}\`${name ? `\n${cut(name, 100)}` : ''}` : 'Nie zapisano';
  const label = record.buyerId === OWNER_ID ? 'Wpis właściciela — wewnętrzny' : record.type === 'zakup' ? 'Zakup klienta' : 'Sprzedaż klienta do sklepu';
  const kinds = { 'staff-completion': 'Zgłoszenie realizacji przez obsługę', 'customer-rep': 'Potwierdzenie +rep od klienta',
    'anonymous-ticket': 'Anonimowy LC powiązany z ticketem', 'history-customer-rep': 'Import: wiadomość klienta i historia zakupów',
    'history-ticket-archive': 'Import: archiwum ticketu', 'history-database': 'Import: zachowana historia zakupów z /ticket-zakoncz' };
  return { allowedMentions: { parse: [] }, embeds: [{ color: 0x27ae60, title: `📒 ${label} — rejestr`,
    description: record.evidence,
    fields: [
      { name: 'Użytkownik', value: user(record.buyerId, record.buyerName), inline: true },
      { name: 'Obsługa', value: user(record.sellerId, record.sellerName), inline: true },
      { name: 'Kwota w zgłoszeniu', value: `${(record.amountCents / 100).toFixed(2)} PLN`, inline: true },
      { name: 'Data zgłoszenia / potwierdzenia (UTC)', value: record.occurredAt, inline: true },
      { name: 'Serwer / przedmiot', value: cut(record.server), inline: true },
      { name: 'Metoda płatności podana w tickecie', value: cut(record.paymentMethod), inline: true },
      { name: 'ID transakcji / wpis bazy', value: cut(record.transactionId || record.purchaseId || record.key) },
      { name: 'Źródło', value: `${record.sourceUrl}\nTicket: ${record.ticketId || 'brak w zachowanych danych'}\nRodzaj: ${kinds[record.sourceKind] || 'Zdarzenie ticketu'}` },
      { name: 'Weryfikacja', value: 'Zapis zdarzenia w Discordzie. Brak niezależnego potwierdzenia wpłaty. Import nie zmienia daty oryginalnej transakcji.' },
    ], footer: { text: `transaction-audit:${record.key}` }, timestamp: record.recordedAt,
  }] };
}
function createTransactionAudit({ load, save, getChannel, getSources, readPurchases, cooldown = () => 0,
  readTranscript, cleanupLegacyEnabled = false, log = () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let state, initialized, chain = Promise.resolve(), running = false, lastError = null;
  const pending = new Map();
  const exclusive = fn => { const task = chain.then(fn); chain = task.catch(() => {}); return task; };
  async function init() {
    if (!initialized) initialized = (async () => {
      const stored = await load();
      if (stored && stored.kind !== 'transaction-audit-v1') throw new Error('AUDIT_ROW_OCCUPIED');
      state = stored || { kind: 'transaction-audit-v1', entries: {}, history: {}, createdAt: new Date().toISOString() };
    })().catch(error => { initialized = null; throw error; });
    await initialized;
  }
  async function persist() { await save(structuredClone(state)); }
  async function record(raw) {
    const row = normalizeRecord(raw);
    if (!row) return false;
    pending.set(row.key, row);
    return exclusive(async () => {
      await init();
      if (state.entries[row.key]) { pending.delete(row.key); return false; }
      if (row.key.startsWith('history:') && Object.values(state.entries).some(e =>
        row.sourceMessageId && e.sourceMessageId === row.sourceMessageId || row.ticketId && e.ticketId === row.ticketId &&
        e.buyerId === row.buyerId && e.amountCents === row.amountCents && e.type === row.type)) {
        pending.delete(row.key); return false;
      }
      state.entries[row.key] = row;
      try { await persist(); } catch (error) { delete state.entries[row.key]; throw error; }
      pending.delete(row.key);
      return true;
    });
  }
  async function wait() {
    await sleep(Math.max(1500, cooldown() + 200));
    if (cooldown() > 0) throw Object.assign(new Error('AUDIT_COOLDOWN'), { localCooldown: true });
  }
  async function scanLegacy(channel) {
    if (state.legacyBackup) return;
    const legacy = [];
    let before;
    do {
      await wait();
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!batch.size) break;
      for (const message of batch.values()) {
        if (message.author?.id !== channel.client.user.id) continue;
        if (message.embeds?.some(e => e.footer?.text?.startsWith('transaction-audit:'))) {
          legacy.push({ id: message.id, createdTimestamp: message.createdTimestamp,
            content: message.content || '', embeds: message.embeds.map(e => e.toJSON ? e.toJSON() : e) });
        }
      }
      before = batch.last().id;
      if (batch.size < 100) break;
    } while (before);
    state.legacyBackup = legacy;
    await exclusive(persist);
  }
  async function publish() {
    await init();
    const channel = await getChannel();
    await scanLegacy(channel);
    const entries = Object.values(state.entries).map(reportRecord);
    const complete = Boolean(state.databaseHistory?.done && Object.values(state.history).length &&
      Object.values(state.history).every(p => p?.done));
    const signature = createHash('sha256').update(JSON.stringify({ entries, complete })).digest('hex');
    if (state.summary?.signature === signature) return;
    let message;
    if (state.summary?.messageId) {
      try { message = await channel.messages.fetch(state.summary.messageId); }
      catch (error) { if (error.code !== 10008) throw error; }
    }
    if (!message) {
      await wait();
      const recent = await channel.messages.fetch({ limit: 100 });
      message = [...recent.values()].find(m => m.author?.id === channel.client.user.id &&
        m.embeds?.some(e => e.footer?.text === 'transaction-audit-summary:v1'));
    }
    const customers = entries.filter(e => e.partyRole === 'klient');
    const internal = entries.filter(e => e.partyRole === 'właściciel / wpis wewnętrzny');
    const data = {
      allowedMentions: { parse: [] },
      embeds: [{ title: '📒 Historia transakcji — pliki i podsumowanie', color: 0x4377ff,
        description: 'Pełne szczegóły znajdziesz w załącznikach. Ten panel aktualizuje się w miejscu — bez osobnych wiadomości dla każdego zakupu.',
        fields: [
          { name: 'Rekordy klientów', value: String(customers.length), inline: true },
          { name: 'Wpisy właściciela / wewnętrzne', value: `${internal.length} — osobny plik, poza rejestrem klientów`, inline: true },
          { name: 'Historia', value: complete ? 'Import zakończony' : 'Import archiwum trwa; załączniki będą uzupełniane' },
          { name: 'Co zawiera CSV', value: 'ID użytkownika, kwota, data, serwer, obsługa i źródło — jeśli zachowano te dane.' },
          { name: 'Weryfikacja', value: 'Zapis zgłoszeń i zdarzeń bota. Nie jest niezależnym potwierdzeniem otrzymania pieniędzy. Etapy jednego zakupu mają wspólne ID.' },
        ], footer: { text: 'transaction-audit-summary:v1' }, timestamp: new Date().toISOString() }],
      attachments: [],
      files: [
        { attachment: Buffer.from(csv(customers), 'utf8'), name: 'historia-transakcji-klientow.csv' },
        { attachment: Buffer.from(csv(internal), 'utf8'), name: 'wpisy-wlasciciela-wewnetrzne.csv' },
        { attachment: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), entries,
          originalAuditCardsBackup: state.legacyBackup, history: state.history }, null, 2), 'utf8'), name: 'rejestr-i-kopia-poprzednich-wpisow.json' },
      ],
    };
    await wait();
    message = message ? await message.edit(data) : await channel.send(data);
    state.summary = { messageId: message.id, signature,
      backupPublished: Boolean(message.attachments?.some?.(a => a.name === 'rejestr-i-kopia-poprzednich-wpisow.json')),
      customerRecords: customers.length, internalRecords: internal.length };
    for (const entry of Object.values(state.entries)) entry.messageId = message.id;
    await exclusive(persist);
  }
  async function cleanupLegacy() {
    if (!cleanupLegacyEnabled) return;
    await init();
    if (state.legacyCleanup?.done) return;
    if (!state.summary?.backupPublished || !state.legacyBackup) throw new Error('AUDIT_BACKUP_REQUIRED');
    const channel = await getChannel();
    // Irreversible deletion is limited to this exact destination, our old audit
    // footer, our bot author and the backed-up IDs. Never touch source LC channels.
    if (channel.id !== AUDIT_CHANNEL_ID || channel.guildId !== GUILD_ID) throw new Error('AUDIT_CLEANUP_WRONG_CHANNEL');
    const progress = state.legacyCleanup ||= { removed: 0, skipped: 0, completedIds: {}, done: false };
    const backedUp = new Set(state.legacyBackup.map(m => m.id));
    const found = new Map();
    let before;
    do {
      await wait();
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!batch.size) break;
      for (const message of batch.values()) if (backedUp.has(message.id)) found.set(message.id,message);
      before=batch.last().id;
      if (batch.size<100) break;
    } while(before);
    const eligible=[];
    for (const previous of state.legacyBackup) {
      if (progress.completedIds[previous.id]) continue;
      const message=found.get(previous.id);
      if (message?.author?.id===channel.client.user.id && message.embeds?.some(e=>e.footer?.text?.startsWith('transaction-audit:'))) eligible.push(message);
      else { progress.skipped++; progress.completedIds[previous.id]=true; }
    }
    const recent=eligible.filter(m=>m.createdTimestamp>Date.now()-13*86400000);
    const older=eligible.filter(m=>!recent.includes(m));
    while(recent.length){
      const batch=recent.splice(0,100);
      await wait();
      if(batch.length>=2 && typeof channel.bulkDelete==='function'){
        const deleted=await channel.bulkDelete(batch.map(m=>m.id),true);
        for(const m of batch) if(deleted.has(m.id)){progress.removed++;progress.completedIds[m.id]=true;} else older.push(m);
      } else older.push(...batch);
      await exclusive(persist);
    }
    for(const message of older){
      await wait(); await message.delete(); progress.removed++; progress.completedIds[message.id]=true;
      await exclusive(persist);
    }
    progress.done = true;
    await exclusive(persist);
  }
  async function importHistory() {
    await init();
    const sources = await getSources();
    if (state.databaseHistory?.done && sources.every(source => state.history[source.channel.id]?.done &&
      (source.kind !== 'archive' || state.history[source.channel.id].parserVersion === 2))) return;
    const rows = await readPurchases();
    for (const source of sources) {
      if (source.kind === 'archive' && state.history[source.channel.id]?.parserVersion !== 2) state.history[source.channel.id] = null;
      const progress = state.history[source.channel.id] ||= { scanned: 0, imported: 0, excluded: 0, before: null, done: false, parserVersion: 2 };
      while (!progress.done) {
        await wait();
        const batch = await source.channel.messages.fetch({ limit: 100, ...(progress.before ? { before: progress.before } : {}) });
        for (const message of batch.values()) {
          let entry;
          if (source.kind === 'rep') entry = fromHumanRep(message, rows);
          else if (message.author?.id === source.channel.client.user.id) {
            const owner = message.embeds?.[0]?.fields?.find(f => f.name === 'Klient')?.value?.match(/\d{16,22}/)?.[0];
            if (owner) {
              const attachment = [...(message.attachments?.values() || [])].find(a => a.name?.endsWith('.txt'));
              if (attachment) {
                // CDN attachments are separate from Discord REST. Keep a small
                // paced read without delaying every file by a full API interval.
                await sleep(250);
                if (cooldown() > 0) throw Object.assign(new Error('AUDIT_COOLDOWN'), { localCooldown: true });
                try { entry = fromTranscript(await readTranscript(attachment.url), message, rows); }
                catch (error) {
                  if (![401, 403, 404].includes(error.status)) throw error;
                  progress.unavailableAttachments = (progress.unavailableAttachments || 0) + 1;
                }
              }
            }
          }
          if (entry && await record(entry)) progress.imported++;
          else progress.excluded++;
          progress.scanned++;
        }
        progress.before = batch.size ? batch.last().id : progress.before;
        progress.done = batch.size < 100;
        await exclusive(persist);
        log({ channel: source.channel.id, ...progress });
        await publish();
      }
      if (source.kind === 'rep' && !state.databaseHistory?.done) {
        const progress = state.databaseHistory ||= { scanned: 0, imported: 0, done: false };
        for (const row of rows) {
          const entry = fromPurchase(row, state.createdAt);
          if (entry && await record(entry)) progress.imported++;
          progress.scanned++;
        }
        progress.done = true;
        await exclusive(persist);
        await publish();
      }
    }
  }
  async function run() {
    if (running) return;
    running = true;
    try { await init(); for (const row of [...pending.values()]) await record(row); await publish(); await cleanupLegacy(); await importHistory(); await publish(); lastError = null; }
    catch (error) { lastError = String(error?.code || error?.status || error?.message || 'AUDIT_ERROR').slice(0, 100); log({ error: lastError }); }
    finally { running = false; }
  }
  return { record, run, cleanupLegacy, snapshot: () => ({ initialized: Boolean(state), running, pending: pending.size, records: state ? Object.keys(state.entries).length : 0,
    published: state ? Object.values(state.entries).filter(e => e.messageId).length : 0,
    history: state?.history || {}, databaseHistory: state?.databaseHistory || null, summary: state?.summary || null,
    legacyCards: state?.legacyBackup?.length || 0, legacyCleanup: state?.legacyCleanup ? {
      removed: state.legacyCleanup.removed, skipped: state.legacyCleanup.skipped, done: state.legacyCleanup.done } : null, lastError }) };
}
module.exports = { AUDIT_CHANNEL_ID, AUDIT_ROW_ID, GUILD_ID, OWNER_ID, reportRecord, csv, money, normalizeRecord, parseRep, fromHumanRep, fromPurchase, fromTranscript, payload, createTransactionAudit };
