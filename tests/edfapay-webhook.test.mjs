import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEdfapayWebhook } from '../lib/edfapay-webhook.js';
import { id, digest } from '../lib/security.js';

const token = 'test-only-' + 'a'.repeat(40);
const env = { EDFAPAY_WEBHOOK_ENABLED: 'true', EDFAPAY_CALLBACK_TOKEN: token, APP_URL: 'https://example.test' };
const payload = { action:'SALE', result:'SUCCESS', status:'SETTLED', order_id:'ANT-TEST-1', trans_id:'test-transaction-1', amount:'299.00', currency:'SAR' };
const params = () => new URLSearchParams({ token });
test('merchant callbacks derive a private URL, retain review-only semantics and respect explicit disable',async()=>{
 const records=[];
 const db={get:async()=>null,insert:async(_,receipt)=>records.push(receipt),list:async()=>records,remove:async()=>{}};
 const merchantEnv={APP_URL:'https://example.test',EDFAPAY_MERCHANT_ID:'12345678-1234-1234-1234-123456789012',EDFAPAY_MERCHANT_PASSWORD:'unit-test-password-not-real'};
 const webhook=createEdfapayWebhook({db,env:merchantEnv});
 assert.equal(webhook.readiness.authentication,'private_callback_url');
 assert.equal(webhook.readiness.signed,false);
 assert.doesNotMatch(JSON.stringify(webhook.readiness)+webhook.callbackUrl,/unit-test-password-not-real/);
 const callback=new URL(webhook.callbackUrl);
 assert.match(callback.searchParams.get('token'),/^[A-Za-z0-9_-]{43}$/);
 assert.equal(createEdfapayWebhook({db,env:merchantEnv}).callbackUrl,webhook.callbackUrl);
 assert.notEqual(createEdfapayWebhook({db,env:{...merchantEnv,EDFAPAY_MERCHANT_PASSWORD:'rotated-test-password'}}).callbackUrl,webhook.callbackUrl);
 await assert.rejects(webhook.receive(request(),new URLSearchParams()),{status:403});
 assert.equal(await webhook.receive(request(),callback.searchParams),'OK');
 assert.equal(records[0].verified,false); assert.equal(records[0].requiresReview,true);
 assert.equal(webhook.readiness.autoConfirmation,false);
 for(const additional of [{EDFAPAY_WEBHOOK_ENABLED:'false'},{EDFAPAY_INTEGRATION:'api_key'}]) assert.equal(createEdfapayWebhook({db,env:{...merchantEnv,...additional}}).readiness.configured,false);
});
function setup(clock = () => Date.now()) {
  const records = new Map();
  const db = { get:async(k, key)=>records.get(key), insert:async(k, item)=>records.set(item.id, item),
    list:async()=>[...records.values()], remove:async(k, key)=>records.delete(key) };
  return { records, h:createEdfapayWebhook({ db, env, clock }) };
}
function request(data = payload, type = 'application/json') {
  const raw = Buffer.from(type === 'application/json' ? JSON.stringify(data) : typeof data === 'string' ? data : new URLSearchParams(data).toString());
  const req = Readable.from([raw]); req.headers = { 'content-type':type }; return req;
}
test('EdfaPay receipts are opt-in and private token is mandatory', async()=>{
  const disabled = createEdfapayWebhook({db:{}, env:{}});
  assert.equal(disabled.callbackUrl, null);
  await assert.rejects(disabled.receive(request(), params()), {status:503});
  const {h,records} = setup();
  await assert.rejects(h.receive(request(), new URLSearchParams()), {status:403});
  await assert.rejects(h.receive(request(), new URLSearchParams('token=wrong')), {status:403});
  await assert.rejects(h.receive(request(), new URLSearchParams('token='+token+'&token='+token)), {status:403});
  assert.equal(records.size,0);
  assert.equal(h.readiness.autoConfirmation,false);
  assert.equal(h.readiness.checkoutEnabled,false);
});
test('card and Apple Pay receipts are bounded, deduplicated and never marked verified', async()=>{
  const {h,records} = setup();
  const data = {...payload, card_number:'PRIVATE', payer_email:'PRIVATE', recurring_token:'PRIVATE', hash:'PRIVATE'};
  await Promise.all([h.receive(request(data), params()), h.receive(request(data), params())]);
  await h.receive(request(data,'application/x-www-form-urlencoded'), params());
  assert.equal(records.size,1);
  assert.equal([...records.values()][0].verified,false);
  assert.doesNotMatch(JSON.stringify([...records.values()]),/PRIVATE|card_number|recurring_token|payer_email|hash|test-only/);
  const apple = {type:'sale',status:'success',order_number:'ANT-TEST-2',id:'apple-reference',order_amount:'100.00',order_currency:'SAR',order_description:'PRIVATE'};
  assert.equal(await h.receive(request(apple),params()),'OK');
  assert.equal(records.size,2);
});
test('multipart callbacks work and duplicate fields or files are rejected',async()=>{
  const {h,records}=setup();
  async function multipart(file=false, duplicate=false) {
    const form=new FormData();for(const [key,value] of Object.entries(payload))form.append(key,value);
    if(file)form.append('file',new Blob(['PRIVATE']),'private.txt');
    if(duplicate)form.append('order_id','OTHER');
    const serialized=new Request('https://example.test',{method:'POST',body:form});
    const req=Readable.from([Buffer.from(await serialized.arrayBuffer())]);req.headers={'content-type':serialized.headers.get('content-type')};return req;
  }
  assert.equal(await h.receive(await multipart(),params()),'OK');
  await assert.rejects(h.receive(await multipart(true),params()),{status:400});
  await assert.rejects(h.receive(await multipart(false,true),params()),{status:400});
  assert.equal(records.size,1);
});
test('malformed, conflicting, oversized and unsupported payloads fail closed',async()=>{
  const {h,records}=setup();
  for(const data of [[],null,{...payload,amount:'NaN'},{...payload,status:'<script>'},{...payload,order_number:'OTHER'},{...payload,trans_id:''},{...payload,currency:'sar'}])
    await assert.rejects(h.receive(request(data),params()),{status:400});
  await assert.rejects(h.receive(request('order_id=x&order_id=y','application/x-www-form-urlencoded'),params()),{status:400});
  await assert.rejects(h.receive(request({...payload,card_number:'x'.repeat(66000)}),params()),{status:413});
  await assert.rejects(h.receive(request(payload,'text/plain'),params()),{status:415});
  assert.equal(records.size,0);
});
test('diagnostic storage is bounded and old receipts expire',async()=>{
  let clock=1000000000000;const {h,records}=setup(()=>clock);
  for(let i=0;i<500;i++)records.set('old-'+i,{id:'old-'+i,receivedAt:clock});
  clock++;
  await h.receive(request(),params());assert.equal(records.size,500);
  clock+=31*86400000;
  await h.receive(request({...payload,trans_id:'another'}),params());assert.equal(records.size,1);
});
test('HTTP callbacks acknowledge text OK, protect admin metadata and never confirm money',async()=>{
  const oldEnv={...process.env},dir=await mkdtemp(join(tmpdir(),'antlaqh-edfapay-'));let app;
  Object.assign(process.env,{...env,NODE_ENV:'test',PORT:'0',APP_URL:'http://localhost:39995',DATA_DIR:dir,DB_DRIVER:'sqlite',BOOTSTRAP_ADMIN_EMAIL:'',BOOTSTRAP_ADMIN_PASSWORD:'',OPENAI_API_KEY:'',TWILIO_ACCOUNT_SID:''});
  try {
    app=await import('../server.js?edfapay='+randomBytes(6).toString('hex'));
    if(!app.server.listening)await new Promise(done=>app.server.once('listening',done));
    const base='http://127.0.0.1:'+app.server.address().port,path='/api/webhooks/edfapay?token='+token;
    const uid=id(),sessionToken=id(),csrf=id();
    await app.db.insert('user',{id:uid,role:'admin',name:'اختبار',email:'admin@example.test'},uid);
    await app.db.insert('session',{id:digest(sessionToken),userId:uid,csrf,expires:Date.now()+86400000,passwordVersion:0},uid);
    const admin={Cookie:'antlaqh_session='+sessionToken};
    const oid=id(),order={id:oid,owner:'test',number:payload.order_id,status:'awaiting_payment',amount:29900,payment:null};
    await app.db.insert('order',order,'test');
    let r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(payload)});
    assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/plain/);assert.equal(await r.text(),'OK');
    assert.deepEqual(await app.db.get('order',oid),order);
    r=await fetch(base+'/api/admin/payments/notifications');assert.equal(r.status,401);
    r=await fetch(base+'/api/admin/payments/notifications',{headers:admin});assert.equal(r.status,200);assert.equal((await r.json())[0].requiresReview,true);
    r=await fetch(base+'/api/admin/channels',{headers:admin});const channels=await r.json();assert.equal(channels.edfapay.callbackUrl,'http://localhost:39995'+path);assert.equal(channels.payment,'bank_transfer');
    r=await fetch(base+'/api/config');const config=await r.text();assert.doesNotMatch(config,new RegExp(token));assert.equal(JSON.parse(config).payments,'bank_transfer');
    r=await fetch(base+path);assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'POST');assert.equal(await r.text(),'ERROR');
    r=await fetch(base+'/api/webhooks/edfapay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(r.status,403);assert.equal(await r.text(),'ERROR');
    // Exemption is limited to callbacks: unrelated writes still require origin/session/CSRF.
    r=await fetch(base+'/api/orders/'+oid+'/confirm-payment',{method:'POST',headers:{...admin,'Content-Type':'application/json'},body:JSON.stringify({reference:'FORGED'})});assert.equal(r.status,403);
    assert.deepEqual(await app.db.get('order',oid),order);
  } finally {
    if(app){await new Promise(done=>app.server.close(done));await app.db.close();}
    for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv);await rm(dir,{recursive:true,force:true});
  }
});
