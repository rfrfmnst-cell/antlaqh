import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { services, customerJourney } from "../lib/catalog.js";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const user = { id: "customer", role: "customer", name: "عميل الاختبار" };
const config = {
  services: [{ id: "website", title: "موقع إلكتروني", description: "تصميم موقع", category: "برمجة" }],
  smsReady: false,
  assistantReady: false,
};
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

test("ready websites preserve template and promotion without customer login", async () => {
  const start = new Date(Date.now()-1000).toISOString(), end = new Date(Date.now()+86400000).toISOString();
  const settings = { ...config,services,customerJourney,launchOffer:{code:"ANTLAQH20",ratePercent:20,active:true,startsAt:start,endsAt:end,terms:[]} };
  const ui = await app({hash:"#/ready-websites",settings});
  assert.match(ui.nodes.get("#main").innerHTML,/\/demos\/business\//);
  assert.match(ui.nodes.get("#main").innerHTML,/template=portfolio&promo=ANTLAQH20/);
  assert.match(ui.nodes.get("#footer").innerHTML,/التحويل البنكي هو وسيلة الدفع الوحيدة حاليًا/);
  ui.location.hash="#/start?service=ready-website&template=portfolio&promo=ANTLAQH20";
  await ui.render();
  assert.match(ui.nodes.get("#main").innerHTML,/name="customerName"/);
  assert.match(ui.nodes.get("#main").innerHTML,/name="customerPhone"/);
  assert.match(ui.nodes.get("#main").innerHTML,/name="customerEmail"/);
  assert.match(ui.nodes.get("#main").innerHTML,/value="portfolio" selected/);
  assert.match(ui.nodes.get("#main").innerHTML,/name="addon_hosting"/);
  assert.match(ui.nodes.get("#main").innerHTML,/name="promoCode"[^>]*value="ANTLAQH20"/);
});
test("study intake asks both choices and renders every price with conditional funding fields", async () => {
  const ui = await app({hash:"#/start?service=feasibility",settings:{...config,services,customerJourney}});
  const html=ui.nodes.get("#main").innerHTML;
  assert.match(html,/name="study_depth"/);
  assert.match(html,/name="study_purpose"/);
  assert.match(html,/id="study-options" class="study-options" >/);
  assert.match(html,/id="study-funding-options" hidden disabled/);
  for(const name of ["stage","activity","city","customers","operations","costs","sales","capital","fundingEntity","fundingAmount","fundingRequirements"]) assert.match(html,new RegExp('name="study_'+name+'"'));
  const detail=ui.serviceDetail("feasibility");
  for(const value of [29900,69900,49900,119900]) assert.ok(detail.includes(new Intl.NumberFormat("ar-SA",{style:"currency",currency:"SAR",maximumFractionDigits:2}).format(value/100)));
  assert.match(detail,/لا يُضمن ربح المشروع أو قبول التمويل/);
  ui.location.hash="#/start?service=website";await ui.render();
  assert.match(ui.nodes.get("#main").innerHTML,/id="study-options" class="study-options" hidden disabled/);
  ui.location.hash="#/study-files/private-order";await ui.render();
  assert.match(ui.nodes.get("#main").innerHTML,/جلسة المتابعة غير متاحة/);
});
test("study input changes update the package price and enable financing requirements only when selected",async()=>{
  const ui=await app({settings:{...config,services,customerJourney}});
  const options={},funding={},preview={},selectors={
    '#study-options':options,'#study-funding-options':funding,'#study-price-preview':preview,
    '[name="service"]':{value:'feasibility'},'[name="study_depth"]':{value:'detailed'},'[name="study_purpose"]':{value:'financing'},
  };
  const form={querySelector:selector=>selectors[selector]||null};
  await ui.event('change',{target:{name:'study_purpose',closest:()=>form}});
  assert.equal(options.disabled,false);assert.equal(funding.disabled,false);assert.match(preview.innerHTML,/دراسة تفصيلية لطلب التمويل/);
  selectors['[name="study_purpose"]'].value='personal';
  await ui.event('change',{target:{name:'study_purpose',closest:()=>form}});
  assert.equal(funding.disabled,true);assert.match(preview.innerHTML,/دراسة تفصيلية للاستخدام الشخصي/);
  selectors['[name="service"]'].value='website';
  await ui.event('change',{target:{name:'service',closest:()=>form}});
  assert.equal(options.hidden,true);assert.equal(options.disabled,true);
});
test("an expired launch offer is no longer advertised but a saved quote shows its original discount", async () => {
  const ui = await app({settings:{...config,services,customerJourney,launchOffer:{code:"ANTLAQH20",ratePercent:20,active:true,startsAt:"2026-01-01T00:00:00Z",endsAt:"2026-02-01T00:00:00Z",terms:[]}}});
  assert.equal(ui.launchBanner(),"");
  assert.doesNotMatch(ui.nodes.get("#main").innerHTML,/بالكود/);
  const saved=ui.priceSummary({subtotal:99000,discount:19800,amount:79200,promotion:{code:"ANTLAQH20",ratePercent:20}});
  assert.match(saved,/السعر قبل الخصم/);
  assert.match(saved,/خصم 20%/);
  assert.match(saved,/الإجمالي النهائي/);
});

async function app({ hash = "#/", session = {}, fetch: request, settings = config } = {}) {
  const listeners = new Map();
  function element() {
    const classes = new Set();
    return {
      innerHTML: "", textContent: "", hidden: true, focusCount: 0,
      classList: {
        contains: (name) => classes.has(name),
        remove: (name) => classes.delete(name),
        add: (name) => classes.add(name),
        toggle(name) {
          if (classes.has(name)) { classes.delete(name); return false; }
          classes.add(name); return true;
        },
      },
      setAttribute(name, value) { this[name] = value; },
      focus() { this.focusCount++; },
      querySelector(selector) {
        if (!selector.startsWith("h1")) return null;
        const heading = this.innerHTML.match(selector.includes("h2") ? /<h[12][^>]*>(.*?)<\/h[12]>/s : /<h1[^>]*>(.*?)<\/h1>/s);
        return heading ? { innerText: heading[1].replace(/<[^>]*>/g, "") } : null;
      },
    };
  }
  const nodes = new Map(["#main", "#header", "#footer", "#toast", "#main-nav", '[data-action="menu"]'].map((key) => [key, element()]));
  const location = { hash };
  const requests = [];
  const document = {
    title: "",
    querySelector: (selector) => nodes.get(selector) || null,
    querySelectorAll: () => [],
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
  };
  const context = vm.createContext({
    document, location, URLSearchParams, Intl, Date,
    File: class {},
    FormData: class { constructor(form) { return Object.entries(form.fields); } },
    setTimeout: () => 1,
    clearTimeout: () => {},
    window: { scrollTo() {}, addEventListener() {}, print() {} },
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (request) {
        const result = await request(path, options);
        if (result) return result;
      }
      if (path === "/api/config") return response(settings);
      if (path === "/api/session") return response(session);
      if (path === "/api/orders") return response([]);
      throw new Error("Unexpected request: " + path);
    },
  });
  const runtime = await new vm.Script(`(async () => { ${source}\nreturn { state, render, api, go, header, paymentCard, paymentPage, serviceDetail, priceSummary, launchBanner, readyWebsites, start, whatsappLink, quoteForm, contractCard, contractDocument }; })()`).runInContext(context);
  return {
    ...runtime, nodes, location, requests, document,
    async event(name, event) {
      for (const handler of listeners.get(name) || []) await handler(event);
    },
  };
}

test("WhatsApp starts a direct channel without copying private customer data", async () => {
  const ui = await app();
  ui.state.user = { id:"private-user",name:"Private customer",email:"private@example.test" };
  const html = ui.whatsappLink();
  assert.match(html,/https:\/\/wa.me\/966553575760\?text=/);
  assert.match(html,/noopener noreferrer/);
  assert.doesNotMatch(html,/private-user|Private customer|private@example/);
});

test("structured contracts require provider and scope details and display a saved version safely", async () => {
  const ui = await app();
  const order = {id:"test-order",number:"INT-TEST",owner:"customer",description:"طلب اختبار محلي",customer:{name:"عميل",email:"customer@example.test"},status:"quoted"};
  const form = ui.quoteForm(order,null);
  for(const field of ["providerLegalName","providerAddress","deliverables","exclusions","clientRequirements","thirdPartyCosts","revisions","reviewDays","supportDays","ownership","cancellation"]) assert.match(form,new RegExp(`name="${field}"[^>]*required`));
  const quote = {id:"contract-old",version:2,amount:99000,createdAt:"2026-10-01",deliveryDate:"2026-11-01",agreement:"نطاق محفوظ",terms:"شروط محفوظة",parties:{provider:"المقدم القديم",customer:order.customer},providerDetails:{registrationType:"freelance_certificate",registrationNumber:"FL-TEST"},document:{policyVersion:"2026-10-01",sections:[{title:"الملكية",body:"<img src=x onerror=alert(1)>"}]}};
  const html = ui.contractCard(quote,order,true);
  assert.match(html,/شهادة العمل الحر/);
  assert.match(html,/المقدم القديم/);
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img src=x/);
  assert.match(html,/#\/contract\/test-order\/contract-old/);
});

test("contract documents require an active follow-up session without customer login", async () => {
  const ui = await app({hash:"#/contract/private-order/saved-version"});
  assert.match(ui.nodes.get("#main").innerHTML,/جلسة المتابعة غير متاحة/);
  assert.match(ui.nodes.get("#main").innerHTML,/ابدأ طلبًا/);
  assert.doesNotMatch(ui.nodes.get("#main").innerHTML,/إنشاء حساب/);
  assert.equal(ui.requests.some(r=>r.path.includes("private-order")),false);
});

test("the contract form sends validated field groups and converts riyals to halalas", async () => {
  let saved;
  const ui = await app({hash:"#/services",session:{user:{id:"admin",role:"admin",name:"مشرف"},csrf:"test-csrf"},fetch:async(path,options)=>{
    if(path==="/api/orders/test-order/quote") {saved=JSON.parse(options.body);return response({});}
  }});
  const button={textContent:"إرسال",disabled:false};
  const form={dataset:{form:"quote",id:"test-order"},fields:{agreement:"نطاق الاختبار",terms:"شروط الاختبار",deliveryDate:"2026-12-01",amount:"999.99",providerLegalName:"مقدم اختبار",providerAddress:"عنوان اختبار محلي",providerRegistrationNumber:"FL-LOCAL",providerRegistrationType:"freelance_certificate",providerActivity:"نشاط تجريبي",deliverables:"ملفات الموقع المتفق عليها",exclusions:"استثناءات الاختبار",clientRequirements:"المحتوى المعتمد",thirdPartyCosts:"رسوم مزود خارجية",revisions:"2",reviewDays:"7",supportDays:"30",ownership:"حقوق الاستخدام المحددة",cancellation:"آلية إلغاء محددة"},querySelector(selector){return selector==="button[type=submit]"?button:null;}};
  await ui.event("submit",{preventDefault(){},target:{closest(){return form;}}});
  assert.equal(saved.amount,99999);
  assert.equal(saved.contractDetails.provider.registrationType,"freelance_certificate");
  assert.equal(saved.contractDetails.revisions,2);
  assert.equal(saved.contractDetails.supportDays,30);
  assert.equal(saved.providerAddress,undefined);
  assert.equal(button.disabled,false);
});

test("initial connection failure offers a retry that reloads config and session", async () => {
  let attempts = 0;
  const ui = await app({ fetch(path) {
    if (path === "/api/config" && ++attempts === 1) throw new Error("Connection failed");
  } });
  assert.match(ui.nodes.get("#main").innerHTML, /data-action="retry"/);
  assert.equal(ui.state.ready, false);
  await ui.render();
  assert.equal(attempts, 2);
  assert.equal(ui.state.ready, true);
  assert.match(ui.nodes.get("#main").innerHTML, /homepage-assistant/);
});

test("an expired customer session clears account state without restoring customer login", async () => {
  const ui = await app({ hash: "#/orders", session: { user, csrf: "expired" }, fetch(path) {
    if (path === "/api/orders") return response({ error: "يلزم تسجيل الدخول." }, 401);
  } });
  assert.equal(ui.state.user, null);
  assert.equal(ui.state.csrf, "");
  assert.match(ui.nodes.get("#main").innerHTML, /جلسة المتابعة غير متاحة/);
  assert.match(ui.nodes.get("#main").innerHTML, /ابدأ طلبًا/);
  assert.doesNotMatch(ui.nodes.get("#header").innerHTML, /login-link|user-chip/);
});

test("a successful response with invalid JSON is retried instead of caching broken configuration", async () => {
  let attempts = 0;
  const ui = await app({ fetch(path) {
    if (path === "/api/config" && ++attempts === 1) {
      return { ok: true, status: 200, json: async () => { throw new SyntaxError("Invalid JSON"); } };
    }
  } });
  assert.equal(ui.state.ready, false);
  assert.match(ui.nodes.get("#main").innerHTML, /data-action="retry"/);
  await ui.render();
  assert.equal(ui.state.ready, true);
  assert.match(ui.nodes.get("#main").innerHTML, /homepage-assistant/);
});

test("expired protected auth requests clear the session, while a rejected login keeps it", async () => {
  const ui = await app({ session: { user, csrf: "token" }, fetch(path) {
    if (path === "/api/auth/login" || path === "/api/auth/login-phone") return response({ error: "Rejected" }, 401);
  } });
  await assert.rejects(ui.api("/api/auth/login", { method: "POST", body: {} }));
  assert.equal(ui.state.user, user);
  await assert.rejects(ui.api("/api/auth/login-phone", { method: "POST", body: {} }));
  assert.equal(ui.state.user, null);
});

test("an old failed request does not clear a more recent login", async () => {
  let finish;
  const ui = await app({ session: { user, csrf: "old" }, fetch(path) {
    if (path === "/api/private-slow") return new Promise((resolve) => { finish = resolve; });
  } });
  const pending = ui.api("/api/private-slow");
  const newerUser = { ...user, name: "جلسة جديدة" };
  ui.state.user = newerUser;
  ui.state.csrf = "new";
  finish(response({ error: "Session expired" }, 401));
  await assert.rejects(pending);
  assert.equal(ui.state.user, newerUser);
  assert.equal(ui.state.csrf, "new");
});

test("navigation to the same hash keeps customer account controls hidden", async () => {
  const ui = await app({ hash: "#/services" });
  const sequence = ui.state.sequence;
  ui.state.user = user;
  await ui.go("/services");
  assert.equal(ui.state.sequence, sequence + 1);
  assert.doesNotMatch(ui.nodes.get("#header").innerHTML, /user-chip|login-link/);
});

test("configured contact and bank details are shown without HTML injection", async () => {
  const ui = await app();
  ui.state.config = {
    ...config,
    businessPhone: "+966500000001",
    businessEmail: "contact@example.test",
    bankTransfer: { bank: 'بنك <اختبار>', iban: 'SA-test"<iban>' },
  };
  ui.header("/");
  assert.match(ui.nodes.get("#footer").innerHTML, /tel:\+966500000001/);
  assert.match(ui.nodes.get("#footer").innerHTML, /mailto:contact@example\.test/);
  ui.state.user = user;
  const payment = ui.paymentCard({ id: "order", number: "ORD-test", amount: 10000, status: "awaiting_payment", files: [] });
  assert.match(payment, /بنك &lt;اختبار&gt;/);
  assert.match(payment, /value="SA-test&quot;&lt;iban&gt;"/);
  assert.doesNotMatch(payment, /<اختبار>/);
});

test("EdfaPay checkout appears only when configured and redirects through the server-created session", async () => {
  const settings = { ...config, paymentMethods:{bankTransfer:{available:true},edfapay:{available:true,mode:"sandbox"}}, bankTransfer:{bank:"بنك الاختبار",iban:"SA000"} };
  const ui = await app({ hash:"#/services", settings, session:{user,csrf:"csrf"}, fetch:async(path)=>{
    if(path==="/api/orders/order-1/payment-session") return response({redirectUrl:"https://demo.edfapay.com/pay/checkout?sessionId=test"});
  }});
  ui.state.user=user;
  ui.state.config=settings;
  const html=ui.paymentCard({id:"order-1",number:"ANT-1",amount:29900,status:"awaiting_payment",files:[]});
  assert.match(html,/data-form="edfapay-payment"/);
  assert.match(html,/دفع إلكتروني عبر مبسط/);
  assert.match(html,/تحويل بنكي/);
  const button={textContent:"الدفع",disabled:false};
  const form={dataset:{form:"edfapay-payment",id:"order-1"},fields:{},querySelector(selector){return selector==="button[type=submit]"?button:null;}};
  await ui.event("submit",{preventDefault(){},target:{closest(){return form;}}});
  assert.equal(ui.location.href,"https://demo.edfapay.com/pay/checkout?sessionId=test");
  assert.equal(button.disabled,false);
});

test("EdfaPay return page never claims payment is confirmed from the browser redirect", async () => {
  const order={id:"order-2",owner:"customer",number:"ANT-2",amount:49900,status:"awaiting_payment",files:[],contracts:[{id:"contract-2",acceptedAt:"2026-10-04T10:00:00Z"}],currentContract:"contract-2",type:"service"};
  const settings={...config,paymentMethods:{bankTransfer:{available:true},edfapay:{available:true,mode:"sandbox"}}};
  const ui=await app({settings,session:{user,csrf:"csrf"},fetch:async(path)=>path==="/api/orders/order-2"?response(order):null});
  const html=await ui.paymentPage("order-2",new URLSearchParams("provider=edfapay&result=success"));
  assert.match(html,/نتحقق من إشعار EdfaPay الموقّع/);
  assert.doesNotMatch(html,/تم تأكيد استلام الدفع/);
});

test("service detail uses the catalog fallback artwork for an additional service", async () => {
  const ui = await app();
  ui.state.config = { ...config, services: [{ id: "new-service", title: "خدمة جديدة", category: "خدمات", description: "تفاصيل الخدمة" }] };
  assert.match(ui.serviceDetail("new-service"), /\/assets\/catalog-website.webp/);
});

test("mobile menu closes on the current navigation link and on Escape", async () => {
  const ui = await app({ hash: "#/services" });
  const nav = ui.nodes.get("#main-nav"), button = ui.nodes.get('[data-action="menu"]');
  nav.classList.add("open");
  button.setAttribute("aria-expanded", "true");
  await ui.event("click", { target: { closest(selector) { return selector === "#main-nav a" ? {} : null; } } });
  assert.equal(nav.classList.contains("open"), false);
  assert.equal(button["aria-expanded"], "false");
  nav.classList.add("open");
  await ui.event("keydown", { key: "Escape" });
  assert.equal(nav.classList.contains("open"), false);
  assert.equal(button.focusCount, 1);
});

test('admin inbox escapes customer content and saves replies through existing order form',async()=>{
 const order={id:'a'.repeat(36),number:'ANT-1',title:'<script>bad</script>',customer:{name:'عميل'},messages:[{role:'customer',message:'<img src=x>',at:'2026-10-04T10:00:00Z'}]};
 const ui=await app({hash:'#/admin/messages',session:{user:{id:'admin',name:'الإدارة',role:'admin'}},fetch:async p=>p==='/api/orders?all=1'?response([order]):null});
 const html=ui.nodes.get('#main').innerHTML;assert.match(html,/صندوق رسائل الطلبات/);assert.match(html,/آخر رد من العميل/);assert.match(html,/data-form="message"/);assert.match(html,/maxlength="4000"/);assert.doesNotMatch(html,/<script>bad/);assert.doesNotMatch(html,/<img src=x>/);assert.match(html,/&lt;img/);
});
test('admin channel page describes disabled delivery honestly and makes no outbound send',async()=>{
 const ui=await app({hash:'#/admin/channels',session:{user:{id:'admin',name:'الإدارة',role:'admin'}},fetch:async p=>p==='/api/admin/channels'?response({email:{ready:false},whatsapp:{ready:false,direct:true},sms:{configured:false}}):null});
 assert.match(ui.nodes.get('#main').innerHTML,/Meta لا يرسل SMS/);assert.match(ui.nodes.get('#main').innerHTML,/الإرسال الآلي غير مفعّل/);assert.match(ui.nodes.get('#main').innerHTML,/قنوات الإرسال/);assert.equal(ui.requests.some(r=>r.options?.method==='POST'),false);
});
