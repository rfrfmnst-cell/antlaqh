import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHmac,randomBytes} from "node:crypto";
import {id,digest} from "../lib/security.js";

test("Tap return verification is restricted to recorded owner attempts and never settles the order",async()=>{
 const originalFetch=globalThis.fetch,oldEnv={...process.env};
 const dir=await mkdtemp(join(tmpdir(),"antlaqh-tap-status-"));
 const key="sk_test_"+"x".repeat(32),merchant="test-merchant";
 let app,calls=0,providerCharge;
 try {
  Object.assign(process.env,{NODE_ENV:"test",PORT:"0",APP_URL:"http://localhost:39996",DATA_DIR:dir,DB_DRIVER:"sqlite",
   BOOTSTRAP_ADMIN_EMAIL:"",BOOTSTRAP_ADMIN_PASSWORD:"",OPENAI_API_KEY:"",TWILIO_ACCOUNT_SID:"",
   TAP_CHECKOUT_ENABLED:"true",TAP_SECRET_KEY:key,TAP_MERCHANT_ID:merchant,TAP_ALLOW_LIVE:"false"});
  globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>structuredClone(providerCharge)};};
  app=await import("../server.js?tap-status="+randomBytes(6).toString("hex"));
  if(!app.server.listening) await new Promise(resolve=>app.server.once("listening",resolve));
  globalThis.fetch=originalFetch;
  const base=`http://127.0.0.1:${app.server.address().port}`;
  async function actor(){
   const uid=id(),token=id();
   await app.db.insert("user",{id:uid,role:"customer",name:"عميل اختبار",email:"",phone:"+966550000001",
    phoneVerified:true,accessPolicyVersion:"2026-11-15",passwordVersion:0,authVersion:0},uid);
   await app.db.insert("session",{id:digest(token),userId:uid,csrf:id(),expires:Date.now()+60000,
    authentication:"phone_otp",passwordVersion:0,authVersion:0},uid);
   return {uid,cookie:`antlaqh_session=${token}`};
  }
  const owner=await actor(),other=await actor(),oid=id(),chargeId="chg_STATUS0123456789",ref="ANT-STATUS-ABC123";
  const order={id:oid,owner:owner.uid,number:"ANT-STATUS",status:"awaiting_payment",amount:69000,payment:null,
   currentContract:"accepted-contract",contracts:[{id:"accepted-contract",acceptedAt:new Date().toISOString()}],files:[],events:[]};
  await app.db.insert("order",order,owner.uid);
  await app.db.insert("tapAttempt",{id:digest(ref),providerOrderId:ref,chargeId,orderId:oid,
   amount:69000,currency:"SAR",contractId:order.currentContract,createdAt:new Date().toISOString()},owner.uid);
  providerCharge={id:chargeId,object:"charge",status:"CAPTURED",live_mode:false,merchant_id:merchant,
   amount:690,currency:"SAR",reference:{order:ref,gateway:"gate",payment:"payment"},transaction:{created:"1794870000000"},
   customer:{email:"private@example.test"},card:{last_four:"1019"}};
  const path=`/api/orders/${oid}/payment-status?provider=tap&chargeId=${chargeId}`;
  async function get(path,as=owner){
   const r=await originalFetch(base+path,{headers:as?{Cookie:as.cookie}:{}});
   return {status:r.status,data:await r.json()};
  }
  assert.equal((await get(path,null)).status,401);
  assert.equal((await get(path,other)).status,404);
  assert.equal((await get(path.replace(chargeId,"chg_NOTOWNED123456"))).status,404);
  assert.equal(calls,0);
  let response=await get(path);
  assert.equal(response.status,200);
  assert.equal(response.data.status,"CAPTURED");
  assert.equal(response.data.mode,"sandbox");
  assert.equal(response.data.webhookVerified,false);
  assert.equal(response.data.requiresReview,true);
  assert.doesNotMatch(JSON.stringify(response.data),/private|1019|sk_test_/);
  const signed="x_id"+chargeId+"x_amount690.00x_currencySARx_gateway_referencegatex_payment_referencepaymentx_statusCAPTUREDx_created1794870000000";
  const signature=createHmac("sha256",key).update(signed).digest("hex");
  const webhook=await originalFetch(base+"/api/webhooks/tap",{method:"POST",
   headers:{"Content-Type":"application/json",hashstring:signature},body:JSON.stringify(providerCharge)});
  assert.equal(webhook.status,200);
  response=await get(path);
  assert.equal(response.data.webhookVerified,true);
  const saved=await app.db.get("order",oid);
  assert.equal(saved.status,"awaiting_payment");
  assert.equal(saved.payment,null);
  providerCharge.amount=1;
  assert.equal((await get(path)).status,502);
 } finally {
  globalThis.fetch=originalFetch;
  if(app){
   if(app.server.listening){const done=new Promise(resolve=>app.server.close(resolve));app.server.closeAllConnections();await done;}
   await app.db.close();
  }
  for(const name of Object.keys(process.env)) if(!(name in oldEnv)) delete process.env[name];
  Object.assign(process.env,oldEnv);
  await rm(dir,{recursive:true,force:true});
 }
});
