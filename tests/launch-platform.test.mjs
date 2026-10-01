import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { contractDetailsFixture } from "./contract-fixture.mjs";

test("launch purchase preserves valid choices, calculates each quote once, and keeps bank-only payment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-launch-"));
  const RealDate = Date;
  const env = { ...process.env };
  let clock = RealDate.parse("2026-10-01T12:00:00+03:00"), app;
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
  const secret = "Test-only-" + randomBytes(18).toString("hex");
  Object.assign(process.env, { NODE_ENV:"test", PORT:"0", APP_URL:"http://localhost:39999", DATA_DIR:dir, DB_DRIVER:"sqlite", OPENAI_API_KEY:"", TWILIO_ACCOUNT_SID:"", GOOGLE_ANALYTICS_ID:"" });
  try {
    app = await import("../server.js?launch=" + randomBytes(6).toString("hex"));
    if (!app.server.listening) await new Promise(done => app.server.once("listening", done));
    const base = "http://127.0.0.1:" + app.server.address().port;
    async function req(path, body, actor) {
      if (path.endsWith("/quote") && body && body.contractDetails === undefined)
        body = { ...body, contractDetails: structuredClone(contractDetailsFixture) };
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { ...(body ? { Origin:"http://localhost:39999", "Content-Type":"application/json" } : {}), ...(actor ? { Cookie:actor.cookie, "X-CSRF-Token":actor.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json();
      return { status:response.status, data, headers:response.headers };
    }
    const registered = await req("/api/auth/register", { name:"اختبار الإطلاق", email:"launch@example.test", password:secret, acceptTerms:true });
    assert.equal(registered.status,201);
    const actor = { ...registered.data, cookie:registered.headers.get("set-cookie").split(";")[0] };
    const config = await req("/api/config");
    assert.equal(config.data.payments,"bank_transfer");
    assert.equal(config.data.integrations.ga4MeasurementId,null);
    assert.equal(config.data.customerJourney.length,4);
    const payload = { type:"service", service:"ready-website", template:"business", addons:["hosting","domain","deployment"], title:"موقع جاهز للاختبار", description:"نحتاج موقع شركة مع إضافات اختيارية للاختبار.", promoCode:"ANTLAQH20", amount:1, promotion:{ ratePercent:100 } };
    let r = await req("/api/orders", { ...payload, addons:["free-payment"] }, actor);
    assert.equal(r.status,400);
    r = await req("/api/orders", { ...payload, template:"unknown" }, actor);
    assert.equal(r.status,400);
    r = await req("/api/orders",payload,actor);
    assert.equal(r.status,201);
    const order = r.data;
    assert.equal(order.amount,undefined);
    assert.equal(order.promotion.ratePercent,20);
    assert.deepEqual(order.siteOptions.addons.map(a=>a.id),["hosting","domain","deployment"]);
    const admin = await app.db.get("user",actor.user.id);
    admin.role="admin";
    await app.db.update("user",admin.id,()=>admin);
    const quote = { agreement:"يشمل نموذج الموقع والإضافات المختارة ضمن هذا الاتفاق.", amount:99999, deliveryDate:"2026-12-01", terms:"شروط الاختبار ومخرجات التسليم واضحة للعميل." };
    r = await req("/api/orders/"+order.id+"/quote",quote,actor);
    assert.equal(r.status,200);
    assert.equal(r.data.subtotal,99999);
    assert.equal(r.data.discount,20000);
    assert.equal(r.data.amount,79999);
    clock = RealDate.parse("2026-11-01T00:00:00+03:00");
    const login = await req("/api/auth/login",{email:"launch@example.test",password:secret});
    Object.assign(actor,login.data,{cookie:login.headers.get("set-cookie").split(";")[0]});
    assert.equal((await req("/api/orders",payload,actor)).status,400);
    r = await req("/api/orders/"+order.id+"/quote",{ ...quote,amount:200000 },actor);
    assert.equal(r.status,200);
    assert.equal(r.data.subtotal,200000);
    assert.equal(r.data.discount,40000);
    assert.equal(r.data.amount,160000);
    assert.equal(r.data.contracts.length,2);
    assert.equal(r.data.contracts[0].amount,79999);
    await req("/api/orders/"+order.id+"/accept",{ accept:true,contractId:r.data.currentContract },actor);
    r = await req("/api/orders/"+order.id+"/confirm-payment",{ reference:"Local test transfer" },actor);
    assert.equal(r.status,200);
    assert.equal(r.data.payment.amount,160000);
    r = await req("/api/orders/"+order.id+"/confirm-payment",{ reference:"Repeated local test" },actor);
    assert.equal(r.data.payment.amount,160000);
    const html = await fetch(base+"/ready-websites/");
    assert.equal(html.status,200);
    assert.match(await html.text(),/موقع جاهز/);
    const sitemap = await fetch(base+"/sitemap.xml");
    assert.match(sitemap.headers.get("content-type"),/xml/);
    const demo = await fetch(base+"/demos/business/");
    assert.equal(demo.status,200);
    assert.match(await demo.text(),/noindex,follow/);
  } finally {
    if (app) { app.server.closeAllConnections(); await new Promise(done=>app.server.close(done)); await app.db.close(); }
    globalThis.Date=RealDate;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env,env);
    await rm(dir,{ recursive:true,force:true });
  }
});
