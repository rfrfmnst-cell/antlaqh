import test from "node:test";
import assert from "node:assert/strict";
import { createEdfapayCheckout } from "../lib/edfapay-checkout.js";

const acceptedOrder = {
  id: "a".repeat(36),
  number: "ANT-TEST-1",
  status: "awaiting_payment",
  amount: 29900,
  payment: null,
  customer: { name: "عميل اختبار", email: "payer@example.test", phone: "0551234567" },
  currentContract: "contract-1",
  contracts: [{ id: "contract-1", acceptedAt: "2026-10-04T10:00:00Z" }],
};

test("EdfaPay hosted checkout is opt-in and never exposes a key in readiness", async () => {
  const checkout = createEdfapayCheckout({ env: { NODE_ENV:"test", APP_URL:"http://localhost" }, request: async()=>{ throw Error("unused"); } });
  assert.equal(checkout.readiness.configured, false);
  assert.equal(JSON.stringify(checkout.readiness).includes("key"), false);
  await assert.rejects(checkout.initiate({ order: acceptedOrder, providerOrderId:"ANT-TEST-1-ABC12345" }), { status:503 });
});

test("hosted checkout sends the authoritative order amount server-side and returns only an EdfaPay redirect", async () => {
  let call;
  const checkout = createEdfapayCheckout({
    env: { NODE_ENV:"test", APP_URL:"http://localhost:3000", EDFAPAY_CHECKOUT_ENABLED:"true", EDFAPAY_API_KEY:"test-api-key-"+"x".repeat(32), EDFAPAY_INITIATE_URL:"https://demo-api.edfapay.com/api/v1/payment-gateway/initiate" },
    origin: "http://localhost:3000",
    request: async (url, options) => {
      call = { url, options };
      return { ok:true, json:async()=>({ code:200, data:{ redirectUrl:"https://demo.edfapay.com/pay/checkout?sessionId=test" } }) };
    },
  });
  assert.equal(checkout.readiness.configured,true);
  assert.equal(checkout.readiness.mode,"sandbox");
  const result = await checkout.initiate({ order: acceptedOrder, providerOrderId:"ANT-TEST-1-ABC12345" });
  assert.match(result.redirectUrl,/^https:\/\/demo\.edfapay\.com\//);
  assert.equal(call.url,"https://demo-api.edfapay.com/api/v1/payment-gateway/initiate");
  assert.equal(call.options.headers["X-API-KEY"],"test-api-key-"+"x".repeat(32));
  const payload=JSON.parse(call.options.body);
  assert.equal(payload.orderId,"ANT-TEST-1-ABC12345");
  assert.equal(payload.amount,299);
  assert.equal(payload.currency,"SAR");
  assert.equal(payload.auth,"N");
  assert.equal(payload.recurringInit,"N");
  assert.equal(payload.customerDetails.phone,"+966551234567");
  assert.match(payload.successUrl,/#\/payment\/a{36}\?provider=edfapay&result=success$/);
  assert.doesNotMatch(call.options.body,/test-api-key/);
});


test("sandbox deployment aliases use the sandbox key without requiring the production variable name", async () => {
  let call;
  const checkout = createEdfapayCheckout({
    env: {
      NODE_ENV:"test",
      APP_URL:"http://localhost:3000",
      EDFAPAY_SANDBOX_API_KEY:"sandbox-key-"+"s".repeat(32),
    },
    origin:"http://localhost:3000",
    request:async(url,options)=>{
      call={url,options};
      return {ok:true,json:async()=>({code:200,data:{redirectUrl:"https://demo.edfapay.com/pay/checkout?sessionId=alias-test"}})};
    },
  });
  assert.equal(checkout.readiness.configured,true);
  assert.equal(checkout.readiness.mode,"sandbox");
  await checkout.initiate({order:acceptedOrder,providerOrderId:"ANT-TEST-1-SANDBOX1"});
  assert.equal(call.url,"https://demo-api.edfapay.com/api/v1/payment-gateway/initiate");
  assert.equal(call.options.headers["X-API-KEY"],"sandbox-key-"+"s".repeat(32));
});

test("checkout rejects forged states, missing contact details, and non-EdfaPay redirects", async () => {
  let called=0;
  const checkout = createEdfapayCheckout({
    env: { NODE_ENV:"test", APP_URL:"http://localhost:3000", EDFAPAY_CHECKOUT_ENABLED:"true", EDFAPAY_API_KEY:"k".repeat(32) },
    request: async()=>{called++;return {ok:true,json:async()=>({data:{redirectUrl:"https://evil.example/pay"}})};},
  });
  await assert.rejects(checkout.initiate({order:{...acceptedOrder,status:"quoted"},providerOrderId:"ANT-TEST-1-ABC12345"}),{status:409});
  await assert.rejects(checkout.initiate({order:{...acceptedOrder,customer:{...acceptedOrder.customer,phone:"bad"}},providerOrderId:"ANT-TEST-1-ABC12345"}),{status:409});
  assert.equal(called,0);
  await assert.rejects(checkout.initiate({order:acceptedOrder,providerOrderId:"ANT-TEST-1-ABC12345"}),{status:502});
  assert.equal(called,1);
});


test("explicit false still disables sandbox checkout", async () => {
  const checkout=createEdfapayCheckout({
    env:{
      NODE_ENV:"test",
      APP_URL:"http://localhost:3000",
      EDFAPAY_CHECKOUT_ENABLED:"false",
      EDFAPAY_SANDBOX_API_KEY:"sandbox-key-"+"s".repeat(32),
    },
    request:async()=>{throw Error("unused");},
  });
  assert.equal(checkout.readiness.configured,false);
  await assert.rejects(checkout.initiate({order:acceptedOrder,providerOrderId:"ANT-TEST-1-SANDBOX2"}),{status:503});
});
