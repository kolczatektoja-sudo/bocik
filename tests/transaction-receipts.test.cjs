const test=require('node:test');
const assert=require('node:assert/strict');
const {receipts,receiptPayload,publishReceipts}=require('../transaction-receipts.cjs');
const {OWNER_ID,AUDIT_CHANNEL_ID,GUILD_ID}=require('../transaction-audit.cjs');
const since='2026-11-09T00:00:00+01:00';
const row={key:'anon',transactionId:'ticket:1:2',buyerId:'123456789012345678',type:'zakup',amountCents:1250,server:'Anarchia LF',occurredAt:'2026-11-10T12:00:00Z',sourceKind:'anonymous-ticket'};
test('receipts show one confirmed transaction, exclude owner, staff-only and previous week',()=>{
 const entries=[row,{...row,key:'rep',sourceKind:'customer-rep'}, {...row,key:'staff',transactionId:'other',sourceKind:'staff-completion'},
 {...row,key:'owner',buyerId:OWNER_ID}, {...row,key:'old',transactionId:'old',occurredAt:'2026-11-08T22:59:59Z'}];
 assert.equal(receipts(entries,since).length,1);
 assert.equal(receipts([{...row,occurredAt:'2026-11-08T23:00:00Z'}],since).length,1);
 const p=receiptPayload('x',row,{name:'RealnyNick',avatarURL:'https://cdn.discordapp.com/avatar.png'});
 assert.equal(p.username,'RealnyNick'); assert.ok(p.avatarURL); assert.deepEqual(p.allowedMentions,{parse:[]});
 assert.match(p.embeds[0].description,/KUPIŁ ZA \*\*12,50 ZŁ\*\* NA SERWERZE \*\*Anarchia LF\*\*/);
 assert.match(receiptPayload('x',{...row,type:'sprzedaz'},{}).embeds[0].description,/SPRZEDAŁ/);
});
test('receipt send/save failure recovers the webhook message and restart does not repost it',async()=>{
 const state={entries:{anon:row}}; let sent=0,fail=true;
 const messages=new Map(); messages.last=()=>[...messages.values()].at(-1);
 const webhook={id:'hook',send:async payload=>{sent++;const m={id:'sent',webhookId:'hook',embeds:payload.embeds};messages.set(m.id,m);return m;}};
 const args={state,channel:{id:AUDIT_CHANNEL_ID,guildId:GUILD_ID,messages:{fetch:async()=>messages}},since,
 getWebhook:async()=>webhook,getIdentity:async()=>({name:'Klient'}),wait:async()=>{},persist:async()=>{if(fail)throw Error('save-fail');}};
 await assert.rejects(publishReceipts(args),/save-fail/);assert.equal(sent,1);
 state.receipts={sent:{},since};fail=false;
 await publishReceipts(args);assert.equal(sent,1);assert.equal(state.receipts.sent[row.transactionId],'sent');
 await publishReceipts(args);assert.equal(sent,1);
 await assert.rejects(publishReceipts({...args,channel:{id:'source'}}),/RECEIPT_WRONG_CHANNEL/);
});
