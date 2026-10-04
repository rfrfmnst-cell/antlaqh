import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createMetaWebhook } from '../lib/meta-webhook.js';
const env={META_WEBHOOK_ENABLED:'true',META_APP_SECRET:'a'.repeat(32),META_WEBHOOK_VERIFY_TOKEN:'b'.repeat(40),META_WHATSAPP_ACCOUNT_ID:'123456789',META_WHATSAPP_PHONE_NUMBER_ID:'987654321'};
function setup(){const records=new Map();const db={get:async(k,id)=>records.get(id),insert:async(k,item)=>{assert.ok(!records.has(item.id));records.set(item.id,item);},list:async()=>[...records.values()],remove:async(k,id)=>records.delete(id)};return {records,h:createMetaWebhook({db,env})};}
function payload(account=env.META_WHATSAPP_ACCOUNT_ID,number=env.META_WHATSAPP_PHONE_NUMBER_ID){return {object:'whatsapp_business_account',entry:[{id:account,changes:[{field:'messages',value:{metadata:{phone_number_id:number},messages:[{text:{body:'PRIVATE'}}],statuses:[{id:'wamid.example',status:'delivered',timestamp:'1791110000',recipient_id:'PRIVATE'}]}}]}]};}
function req(p,signature){const raw=Buffer.from(JSON.stringify(p));const r=Readable.from([raw]);r.headers={'content-type':'application/json','x-hub-signature-256':signature??'sha256='+createHmac('sha256',env.META_APP_SECRET).update(raw).digest('hex')};return r;}
test('disabled webhook rejects even well-formed requests',async()=>{const h=createMetaWebhook({db:{},env:{}});assert.equal(h.readiness.configured,false);await assert.rejects(h.receive(req(payload())),{status:503});});
test('challenge requires correct mode, token and bounded numeric challenge',()=>{const {h}=setup();const p=new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':env.META_WEBHOOK_VERIFY_TOKEN,'hub.challenge':'123'});assert.equal(h.challenge(p),'123');p.set('hub.verify_token','wrong');assert.throws(()=>h.challenge(p),{status:403});});
test('unsigned and altered bodies cannot persist receipts',async()=>{const {h,records}=setup();await assert.rejects(h.receive(req(payload(),'sha256='+'0'.repeat(64))),{status:403});assert.equal(records.size,0);});
test('only explicitly configured account and phone are accepted',async()=>{const {h,records}=setup();await h.receive(req(payload('222222222')));await h.receive(req(payload(undefined,'333333333')));assert.equal(records.size,0);});
test('concurrent retries are deduplicated and private messages excluded',async()=>{const {h,records}=setup();await Promise.all([h.receive(req(payload())),h.receive(req(payload()))]);assert.equal(records.size,1);assert.doesNotMatch(JSON.stringify([...records.values()]),/PRIVATE|recipient_id|body/);});
test('signed malformed shape is rejected',async()=>{const {h}=setup();await assert.rejects(h.receive(req({object:'wrong'})),{status:400});});
