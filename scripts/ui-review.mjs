import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { id, digest } from "../lib/security.js";
import { services } from "../lib/catalog.js";

const dir=await mkdtemp(join(tmpdir(),"antlaqh-ui-")),origin="http://127.0.0.1:39990",artifacts=resolve("ui-review");
Object.assign(process.env,{NODE_ENV:"test",PORT:"39990",APP_URL:origin,DATA_DIR:dir,DB_DRIVER:"sqlite",OPENAI_API_KEY:"",TWILIO_ACCOUNT_SID:"",BOOTSTRAP_ADMIN_EMAIL:"",BOOTSTRAP_ADMIN_PASSWORD:"",GA4_MEASUREMENT_ID:""});
let app,browser,page;
try {
  await mkdir(artifacts,{recursive:true});
  app=await import("../server.js?ui-review");
  if(!app.server.listening)await new Promise(done=>app.server.once("listening",done));
  for(const [pid,title,published] of [["ui-guide","دليل تجهيز المتجر",true],["ui-plan","خطة محتوى تجريبية",true],["ui-private","منتج غير منشور",false]]) await app.db.insert("product",{id:pid,title,description:"منتج اختبار محلي لمراجعة تجربة التصفح",category:"موارد رقمية",amount:12000,cover:"content",published,createdAt:new Date().toISOString()},pid);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext(),errors=[];page=await context.newPage();
  page.on("pageerror",e=>errors.push(e.message));
  const routes=["/","/store","/services","/ready-websites","/about","/support","/privacy","/terms","/start","/start?service=content-production","/start?service=feasibility","/start?service=ready-website&template=business",...services.map(s=>"/service/"+s.id)];
  for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:740}]) {
    await page.setViewportSize(viewport);
    for(const route of routes){
      await page.goto(origin+"/#"+route);
      await page.locator("#main h1").waitFor();
      assert.ok(!await page.locator("#main").innerText().then(t=>t.includes("تعذر فتح الصفحة")),route+" failed");
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(layout.scroll<=layout.width+1,`Overflow ${route} at ${viewport.width}: ${layout.scroll}`);
    }
    console.log("PUBLIC_ROUTES_OK",viewport.width,routes.length);
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(origin+"/#/store");
  const count=services.length+3+2;
  assert.equal(await page.locator("[data-catalog-item]").count(),count);
  assert.equal(await page.getByText("منتج غير منشور",{exact:true}).count(),0);
  await page.getByRole("button",{name:"المواقع الجاهزة",exact:true}).click();
  assert.equal(await page.locator("[data-catalog-item]:visible").count(),3);
  await page.getByRole("button",{name:"عرض الكل",exact:true}).click();
  await page.locator("[data-catalog-search]").fill("صِنَاعَة المُحْتَوَى");
  assert.equal(await page.locator("[data-catalog-item]:visible").count(),1);
  await page.locator("[data-catalog-search]").fill("لا يوجد هذا الاسم");
  assert.equal(await page.locator("[data-catalog-item]:visible").count(),0);
  assert.equal(await page.locator("#catalog-empty-results").isVisible(),true);
  await page.getByRole("button",{name:"عرض الكل",exact:true}).click();
  assert.equal(await page.locator("[data-catalog-item]:visible").count(),count);
  await page.locator("[data-catalog-category-filter]").selectOption("تطوير وبرمجة");
  assert.equal(await page.locator("[data-catalog-item]:visible").count(),services.filter(s=>s.category==="تطوير وبرمجة").length);
  await page.getByRole("button",{name:"عرض الكل",exact:true}).click();
  await page.screenshot({path:join(artifacts,"catalog-mobile.png")});
  await page.getByRole("button",{name:"فتح القائمة",exact:true}).click();
  assert.equal(await page.locator("#main-nav").isVisible(),true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#main-nav").isVisible(),false);
  assert.equal(await page.locator('[data-action="menu"]').evaluate(el=>el===document.activeElement),true);
  await page.goto(origin+"/#/start?service=content-production");
  await page.locator("#content-type").selectOption("mixed");
  await page.locator('[name="content_imageCount"]').fill("3");
  await page.locator('[name="content_videoCount"]').fill("2");
  await page.locator("#content-voice").selectOption("ai");
  assert.match(await page.locator("#content-price-preview").innerText(),/٥٧٣/);
  await page.locator("#service").selectOption("website");
  assert.equal(await page.locator("#content-options").isVisible(),false);
  await page.goto(origin+"/#/");
  await page.locator("#home-catalog-query").fill("فيديو");
  await page.locator('[data-form="catalog-search"] button').click();
  await page.locator("[data-catalog-search]").waitFor();
  assert.equal(await page.locator("[data-catalog-search]").inputValue(),"فيديو");
  for(const [width,name] of [[1440,"desktop"],[390,"mobile"]]){
    await page.setViewportSize({width,height:900});await page.goto(origin+"/#/");await page.locator("#main h1").waitFor();
    await page.screenshot({path:join(artifacts,"home-"+name+".png")});
    await page.locator("#footer").screenshot({path:join(artifacts,"footer-"+name+".png")});
  }
  const uid=id(),token=id();await app.db.insert("user",{id:uid,name:"مشرف اختبار",email:"ui-admin@example.test",role:"admin",createdAt:new Date().toISOString()},uid);
  await app.db.insert("session",{id:digest(token),userId:uid,csrf:id(),expires:Date.now()+86400000,passwordVersion:0},uid);
  await context.addCookies([{name:"antlaqh_session",value:token,url:origin}]);
  for(const route of ["/admin","/admin/orders","/admin/messages","/admin/products","/admin/channels","/admin/settings"]){
    await page.goto(origin+"/#"+route);await page.locator("#main h1").waitFor();
    assert.ok(!(await page.locator("#main").innerText()).includes("تعذر فتح الصفحة"),route);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Admin overflow "+route);
  }
  assert.deepEqual(errors,[]);console.log("CATALOG_FILTERS_MENU_CONTENT_FORM_ADMIN_OK");
} catch(error) {
  if(page){
    await page.screenshot({path:join(artifacts,"failure.png"),fullPage:true}).catch(()=>{});
    console.error("UI_FAILURE",await page.evaluate(()=>({url:location.href,width:innerWidth,overflow:[...document.querySelectorAll("body *")].map(el=>({tag:el.tagName,className:typeof el.className==="string" ? el.className : "",rect:el.getBoundingClientRect()})).filter(x=>x.rect.width && (x.rect.right>innerWidth+1 || x.rect.left < -1)).slice(-30).map(x=>({tag:x.tag,className:x.className,left:x.rect.left,right:x.rect.right,width:x.rect.width}))})).catch(()=>null));
  }
  throw error;
} finally {
  if(browser)await browser.close();
  if(app){await new Promise(done=>app.server.close(done));await app.db.close();}
  await rm(dir,{recursive:true,force:true});
}
