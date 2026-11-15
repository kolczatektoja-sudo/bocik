'use strict';
const { createHash } = require('node:crypto');
const { OWNER_ID, AUDIT_CHANNEL_ID, GUILD_ID } = require('./transaction-audit.cjs');
const footerFor = key => 'transaction-receipt:v1:' + createHash('sha256').update(key).digest('hex').slice(0, 32);
function receipts(entries, since) {
  const groups = new Map();
  for (const e of entries) {
    if (e.buyerId === OWNER_ID || Date.parse(e.occurredAt) < Date.parse(since) || e.sourceKind === 'staff-completion') continue;
    const key = e.transactionId || (e.purchaseId ? `purchase:${e.purchaseId}` : e.key);
    const previous = groups.get(key);
    if (!previous || e.sourceKind === 'customer-rep' || e.sourceKind === 'anonymous-ticket') groups.set(key, e);
  }
  return [...groups].map(([key, entry]) => ({ key, entry })).sort((a,b) => Date.parse(a.entry.occurredAt)-Date.parse(b.entry.occurredAt));
}
function receiptPayload(key, entry, identity) {
  const amount = (entry.amountCents/100).toFixed(2).replace('.', ',');
  return {
    username: String(identity.name || entry.buyerName || `Klient ${entry.buyerId}`).slice(0, 80),
    avatarURL: identity.avatarURL || undefined,
    allowedMentions: { parse: [] },
    embeds: [{ color: 0x4377ff,
      description: `${entry.type === 'zakup' ? 'KUPIŁ' : 'SPRZEDAŁ'} ZA **${amount} ZŁ** NA SERWERZE **${String(entry.server || 'nie zapisano').replace(/[\r\n]/g,' ').slice(0,300)}**`,
      fields: [{ name: 'Klient', value: `<@${entry.buyerId}> · ID: ${entry.buyerId}` }],
      timestamp: entry.originalPurchaseAt || entry.occurredAt,
      footer: { text: footerFor(key) },
    }],
  };
}
async function publishReceipts({ state, channel, since, getWebhook, getIdentity, wait, persist }) {
  if (!since || !getWebhook) return;
  if (channel.id !== AUDIT_CHANNEL_ID || channel.guildId !== GUILD_ID) throw new Error('RECEIPT_WRONG_CHANNEL');
  const items = receipts(Object.values(state.entries), since);
  const progress = state.receipts ||= { sent: {}, since };
  const missing = items.filter(item => !progress.sent[item.key]);
  if (!missing.length) return;
  await wait();
  const webhook = await getWebhook(channel);
  // Recover a successful send whose state save was interrupted, including older pages.
  const found = new Map(); let before;
  do {
    await wait();
    const batch = await channel.messages.fetch({limit:100, ...(before ? {before} : {})});
    if (!batch.size) break;
    for (const m of batch.values()) if (m.webhookId === webhook.id) {
      for (const e of m.embeds || []) if (e.footer?.text?.startsWith('transaction-receipt:v1:')) found.set(e.footer.text,m.id);
    }
    before=batch.last().id;
    if(batch.size<100) break;
  } while(before);
  for (const {key,entry} of missing) {
    const recovered=found.get(footerFor(key));
    if (recovered) { progress.sent[key]=recovered; await persist(); continue; }
    await wait();
    const identity=await getIdentity(entry);
    await wait();
    const message=await webhook.send(receiptPayload(key,entry,identity));
    progress.sent[key]=message.id;
    await persist();
  }
  progress.eligible=items.length;
}
module.exports={receipts,receiptPayload,publishReceipts};
