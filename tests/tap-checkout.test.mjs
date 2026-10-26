import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createTapCheckout} from "../lib/tap-checkout.js";
import {verifyTapCharge,createTapWebhook} from "../lib/tap-webhook.js";

const key="sk_test_"+"x".repeat(32);
const order={id:"a".repeat(36),number:"ANT-TEST-1",status:"awaiting_payment",
 amount:29900,payment:null,customer:{name:"عميل اختبار",email:"test@example.com",phone:"0551234567"},
 currentContract:"contract-1",contracts:[{id:"contract-1",acceptedAt:"2026-10-01T00:00:00Z"}]};
const env={NODE_ENV:"test",TAP_CHECKOUT_ENABLED:"true",TAP_SECRET_KEY:key,TAP_MERCHANT_ID:"123456"};
test("Tap stays disabled without its own merchant credentials",async()=>{
 const instance=createTapCheckout({env:{NODE_ENV:"test"}});
 assert.equal(instance.readiness.configured,false);
 assert.doesNotMatch(JSON.stringify(instance.readiness),/sk_test_/);
 await assert.rejects(instance.initiate({order,providerOrderId:"ANT-TEST-1-ABC123"}),{status:503});
});
test("Tap creates a hosted sandbox charge without exposing keys",async()=>{
 let req;
 const service=createTapCheckout({env,origin:"https://antlaqh.com",request:async(url,options)=>{
   req={url,options};return {ok:true,json:async()=>({id:"chg_TEST0123456789",object:"charge",status:"INITIATED",live_mode:false,
     amount:299,currency:"SAR",merchant:{id:"123456"},reference:{order:"ANT-TEST-1-ABC123"},
     transaction:{url:"https://checkout.payments.tap.company?token=test"}})};
 }});
 assert.equal(service.readiness.configured,true);
 assert.equal(service.readiness.mode,"sandbox");
 const session=await service.initiate({order,providerOrderId:"ANT-TEST-1-ABC123"});
 assert.equal(session.chargeId,"chg_TEST0123456789");
 assert.equal(req.url,"https://api.tap.company/v2/charges/");
 const data=JSON.parse(req.options.body);
 assert.equal(data.amount,299);
 assert.equal(data.currency,"SAR");
 assert.equal(data.source.id,"src_all");
 assert.equal(data.merchant.id,"123456");
 assert.equal(data.reference.idempotent,"ANT-TEST-1-ABC123");
 assert.equal(data.post.url,"https://antlaqh.com/api/webhooks/tap");
 assert.match(data.redirect.url,/provider=tap/);
 assert.equal(data.customer.phone.number,"551234567");
 assert.equal(req.options.headers.authorization,"Bearer "+key);
 assert.doesNotMatch(req.options.body,/sk_test_/);
});
test("Tap rejects unsafe redirects and unapproved live activation",async()=>{
 const live={...env,TAP_SECRET_KEY:"sk_live_"+"x".repeat(32)};
 assert.equal(createTapCheckout({env:live}).readiness.configured,false);
 const c=createTapCheckout({env,request:async()=>({ok:true,json:async()=>({
   id:"chg_TEST0123456789",object:"charge",status:"INITIATED",live_mode:false,
   amount:299,currency:"SAR",merchant:{id:"123456"},reference:{order:"ANT-TEST-1-ABC123"},
   transaction:{url:"https://evil.example"}})})});
 await assert.rejects(c.initiate({order,providerOrderId:"ANT-TEST-1-ABC123"}),{status:502});
});
test("Tap refuses a charge for another brand or a mismatched amount",async()=>{
  for (const overrides of [
    {merchant:{id:"rafraf-merchant"}},
    {merchant_id:"rafraf-merchant"},
    {amount:300},
    {currency:"KWD"},
    {live_mode:true},
    {reference:{order:"ANT-OTHER-123"}},
  ]) {
    const payload={id:"chg_TEST0123456789",object:"charge",status:"INITIATED",
      amount:299,currency:"SAR",live_mode:false,merchant:{id:"123456"},
      reference:{order:"ANT-TEST-1-ABC123"},
      transaction:{url:"https://checkout.payments.tap.company?token=test"},...overrides};
    const checkout=createTapCheckout({env,request:async()=>({ok:true,json:async()=>payload})});
    await assert.rejects(checkout.initiate({order,providerOrderId:"ANT-TEST-1-ABC123"}),{status:502});
  }
});
test("Tap signed webhook is verified and never auto-confirms payment",async()=>{
 const charge={id:"chg_TEST0123456789",object:"charge",status:"CAPTURED",amount:299,currency:"SAR",
  live_mode:false,merchant:{id:"123456"},reference:{order:"ANT-TEST-1-ABC123",gateway:"gate1",payment:"pay1"},
  transaction:{created:"1698392202943"}};
 const payload="x_id"+charge.id+"x_amount299.00x_currencySARx_gateway_referencegate1x_payment_referencepay1x_statusCAPTUREDx_created1698392202943";
 const signature=createHmac("sha256",key).update(payload).digest("hex");
 const verified=verifyTapCharge(charge,signature,key);
 assert.equal(verified.amountHalalas,29900);
 assert.equal(verified.status,"CAPTURED");
 assert.throws(()=>verifyTapCharge({...charge,amount:1},signature,key),{status:403});
 const recorded=[];
 const memory={async get(kind){return kind==="tapReceipt"?null:null;},
  async insert(kind,value){recorded.push([kind,value]);}};
 const webhook=createTapWebhook({db:memory,env});
 const raw=Buffer.from(JSON.stringify(charge));
 const req={headers:{"content-type":"application/json",hashstring:signature},
   [Symbol.asyncIterator]:async function*(){yield raw;}};
 assert.equal(await webhook.receive(req),"OK");
 assert.equal(recorded[0][0],"tapReceipt");
 assert.equal(recorded[0][1].verified,true);
 assert.equal(recorded[0][1].requiresReview,true);
 assert.equal(recorded[0][1].orderId,null);
});
