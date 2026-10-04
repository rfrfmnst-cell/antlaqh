import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { id, digest } from "../lib/security.js";

test("merchant checkout accepts billing and records an unpaid attempt without exposing credentials", async () => {
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
      json: async () => ({ redirect_url:"https://pay.edfapay.com/checkout/merchant-test" }),
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
      EDFAPAY_MERCHANT_ID:"12345678-1234-1234-1234-123456789012",
      EDFAPAY_MERCHANT_PASSWORD:"merchant-test-password",
      EDFAPAY_API_KEY:"server-test-key-" + "x".repeat(32),
      EDFAPAY_INITIATE_URL:"https://demo-api.edfapay.com/api/v1/payment-gateway/initiate",
      EDFAPAY_WEBHOOK_ENABLED:"false",
      EDFAPAY_WEBHOOK_SECRET:"",
      EDFAPAY_CALLBACK_TOKEN:"",
    });
    globalThis.fetch = providerFetch;
    app = await import("../server.js?edfapay-merchant-platform=" + randomBytes(6).toString("hex"));
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
      body:JSON.stringify({amount:1,payerIp:"192.0.2.123",billing:{firstName:"Test",lastName:"User",address:"Street 1",city:"Riyadh",zip:"12345",country:"SA"}}),
    });
    assert.equal(response.status,201);
    const data=await response.json();
    assert.equal(data.redirectUrl,"https://pay.edfapay.com/checkout/merchant-test");
    assert.deepEqual(Object.keys(data),["redirectUrl"]);
    assert.equal(providerCall.url,"https://api.edfapay.com/payment/initiate");
    assert.equal(providerCall.options.headers["X-API-KEY"],undefined);
    const sent=Object.fromEntries(providerCall.options.body);
    assert.equal(sent.order_amount,"299.00");
    assert.equal(sent.order_currency,"SAR");
    assert.equal(sent.payer_ip,"127.0.0.1");
    assert.equal(sent.payer_address,"Street 1");
    assert.equal(sent.payer_email,user.email);
    assert.doesNotMatch(JSON.stringify(sent),/merchant-test-password|server-test-key/);
    sent.orderId=sent.order_id;
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
