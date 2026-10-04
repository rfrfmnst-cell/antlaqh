import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { id, digest } from "../lib/security.js";

test("order owner can create an EdfaPay hosted session without exposing the API key", async () => {
  const originalFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-edfapay-checkout-"));
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let providerCall;
  const providerFetch = async (url, options) => {
    providerCall = { url: String(url), options };
    return {
      ok: true,
      json: async () => ({ code:200, data:{ redirectUrl:"https://demo.edfapay.com/pay/checkout?sessionId=server-test" } }),
    };
  };
  let app;
  try {
    Object.assign(process.env, {
      NODE_ENV:"test",
      PORT:String(port),
      APP_URL:base,
      DATA_DIR:dir,
      DB_DRIVER:"sqlite",
      BOOTSTRAP_ADMIN_EMAIL:"",
      BOOTSTRAP_ADMIN_PASSWORD:"",
      OPENAI_API_KEY:"",
      TWILIO_ACCOUNT_SID:"",
      EDFAPAY_CHECKOUT_ENABLED:"true",
      EDFAPAY_API_KEY:"server-test-key-" + "x".repeat(32),
      EDFAPAY_INITIATE_URL:"https://demo-api.edfapay.com/api/v1/payment-gateway/initiate",
      EDFAPAY_WEBHOOK_ENABLED:"false",
      EDFAPAY_WEBHOOK_SECRET:"",
      EDFAPAY_CALLBACK_TOKEN:"",
    });
    globalThis.fetch = providerFetch;
    app = await import("../server.js?edfapay-checkout-platform=" + randomBytes(6).toString("hex"));
    if (!app.server.listening) await new Promise((resolve) => app.server.once("listening", resolve));
    globalThis.fetch = originalFetch;

    const uid=id(), token=id(), csrf=id(), oid=id();
    const user={id:uid,role:"customer",name:"عميل الدفع",email:"payer@example.test",phone:"+966551234567",passwordVersion:0,authVersion:0,createdAt:new Date().toISOString()};
    await app.db.insert("user",user,uid);
    await app.db.insert("session",{id:digest(token),userId:uid,csrf,expires:Date.now()+60000,passwordVersion:0,authVersion:0},uid);
    const order={
      id:oid,owner:uid,number:"ANT-TEST-100",type:"service",service:"website",title:"طلب اختبار",
      status:"awaiting_payment",amount:29900,subtotal:29900,discount:0,payment:null,
      customer:{name:user.name,email:user.email,phone:user.phone},files:[],events:[],messages:[],
      currentContract:"contract-1",contracts:[{id:"contract-1",acceptedAt:new Date().toISOString()}],
    };
    await app.db.insert("order",order,uid);

    const response=await originalFetch(base+`/api/orders/${oid}/payment-session`,{
      method:"POST",
      headers:{Origin:base,Cookie:`antlaqh_session=${token}`,"X-CSRF-Token":csrf,"Content-Type":"application/json"},
      body:"{}",
    });
    assert.equal(response.status,201);
    const data=await response.json();
    assert.equal(data.redirectUrl,"https://demo.edfapay.com/pay/checkout?sessionId=server-test");
    assert.deepEqual(Object.keys(data),["redirectUrl"]);
    assert.equal(providerCall.url,"https://demo-api.edfapay.com/api/v1/payment-gateway/initiate");
    assert.equal(providerCall.options.headers["X-API-KEY"],process.env.EDFAPAY_API_KEY);
    const sent=JSON.parse(providerCall.options.body);
    assert.equal(sent.amount,299);
    assert.equal(sent.currency,"SAR");
    assert.match(sent.orderId,/^ANT-TEST-100-[a-f0-9]{12}$/);
    assert.equal(sent.customerDetails.email,user.email);
    assert.doesNotMatch(JSON.stringify(data),/server-test-key/);

    const attempts=await app.db.list("edfapayAttempt");
    assert.equal(attempts.length,1);
    assert.equal(attempts[0].providerOrderId,sent.orderId);
    assert.equal(attempts[0].orderId,oid);
    assert.equal(attempts[0].amount,29900);
    const saved=await app.db.get("order",oid);
    assert.equal(saved.status,"awaiting_payment");
    assert.equal(saved.payment,null);
    assert.equal(saved.events.filter((event)=>event.message==="تم إنشاء جلسة دفع إلكتروني عبر مبسط").length,1);
  } finally {
    globalThis.fetch = originalFetch;
    if (app) {
      if (app.server.listening) {
        const done=new Promise((resolve)=>app.server.close(resolve));
        app.server.closeAllConnections();
        await done;
      }
      await app.db.close();
    }
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env,oldEnv);
    await rm(dir,{recursive:true,force:true});
  }
});
