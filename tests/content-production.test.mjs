import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { id, digest } from "../lib/security.js";
import { validateContentProduction } from "../lib/content-production.js";
const brief = {type:"mixed",imageCount:"3",imageFormat:"portrait",videoCount:"2",videoMode:"editing",duration:"30",videoFormat:"vertical",voice:"ai",platform:"instagram",language:"ar",brand:"علامة اختبار",audience:"أصحاب متاجر سعودية",goal:"إبراز الخدمات وتشجيع زيارة الموقع",style:"رسمي بسيط بألوان الهوية",references:"مثال تصميم يرسله العميل",sourceUrl:"https://example.test/client-materials"};
test("content pricing covers images, video lengths and modes, voiceover and mixed orders without trusting prices",()=>{
  const cases = [
    [{type:"images",imageCount:"1"},5900],
    [{type:"images",imageCount:"10"},59000],
    [{type:"videos",videoCount:"1",voice:"none"},14900],
    [{type:"videos",videoCount:"1",duration:"60",voice:"none"},24900],
    [{type:"videos",videoCount:"1",videoMode:"production",voice:"none"},29900],
    [{type:"videos",videoCount:"1",videoMode:"production",duration:"60",voice:"ai"},57800],
    [{},57300],
  ];
  for (const [changes,amount] of cases) {
    const saved=validateContentProduction({...brief,...changes,amount:1,quote:{amount:1},imageRate:1});
    assert.equal(saved.quote.amount,amount);
    assert.equal(saved.quote.lines.reduce((sum,x)=>sum+x.amount,0),amount);
    assert.equal(saved.quote.revisions,2);
    if (changes.type==="images") assert.equal(saved.answers.videoCount,undefined);
    if (changes.type==="videos") assert.equal(saved.answers.imageCount,undefined);
  }
  for (const changes of [{type:"bad"},{imageCount:"0"},{imageCount:"1.5"},{imageCount:"31"},{imageCount:[1]},{videoCount:"11"},{videoCount:"-1"},{duration:"120"},{duration:[30]},{videoMode:"filming"},{voice:"human"},{imageFormat:"bad"},{videoFormat:"bad"},{platform:"bad"},{language:"bad"},{sourceUrl:"javascript:alert(1)"},{sourceUrl:"https://user:secret@example.test"}]) assert.throws(()=>validateContentProduction({...brief,...changes}),{status:400});
  assert.doesNotThrow(()=>validateContentProduction({...brief,sourceUrl:""}));
});
test("content purchase snapshots its quote and brief through checkout and contract acceptance",async()=>{
  const env={...process.env},dir=await mkdtemp(join(tmpdir(),"antlaqh-content-"));let app;
  Object.assign(process.env,{NODE_ENV:"test",PORT:"0",APP_URL:"http://localhost:39995",DATA_DIR:dir,DB_DRIVER:"sqlite",OPENAI_API_KEY:"",TWILIO_ACCOUNT_SID:"",BOOTSTRAP_ADMIN_EMAIL:"",BOOTSTRAP_ADMIN_PASSWORD:""});
  try {
    app=await import("../server.js?content="+randomBytes(6).toString("hex"));
    if(!app.server.listening)await new Promise(done=>app.server.once("listening",done));
    const base="http://127.0.0.1:"+app.server.address().port;
    async function actor(suffix){
      const uid=id(),token=id(),csrf=id();
      await app.db.insert("user",{id:uid,name:"عميل محتوى تجريبي",email:suffix+"@example.test",role:"customer",createdAt:new Date().toISOString()},uid);
      await app.db.insert("session",{id:digest(token),userId:uid,csrf,expires:Date.now()+86400000,passwordVersion:0},uid);
      return {cookie:"antlaqh_session="+token,csrf};
    }
    const customer=await actor("content"),other=await actor("other");
    async function req(path,body,as=customer){
      const r=await fetch(base+path,{method:body===undefined?"GET":"POST",headers:{...(body===undefined?{}:{Origin:"http://localhost:39995","Content-Type":"application/json"}),Cookie:as.cookie,"X-CSRF-Token":as.csrf},body:body===undefined?undefined:JSON.stringify(body)});
      return {status:r.status,data:await r.json()};
    }
    const request={service:"content-production",title:"محتوى علامة اختبار",description:"طلب صور وفيديو لاختبار التفاصيل والسعر فقط.",targetDate:"2026-12-20",contentProduction:brief};
    assert.equal((await req("/api/orders",{...request,contentProduction:undefined})).status,400);
    assert.equal((await req("/api/orders",{...request,service:"website"})).status,400);
    for (const choice of [brief,{...brief,type:"images",imageCount:"5"},{...brief,type:"videos",videoCount:"1",videoMode:"production",duration:"60",voice:"none"}]) {
      const created=await req("/api/orders",{...request,contentProduction:{...choice,quote:{amount:1}},amount:1});
      assert.equal(created.status,201);
      const oid=created.data.id,expected=validateContentProduction(choice).quote.amount;
      assert.equal(created.data.advertisedPrice.from,expected);
      assert.equal((await req("/api/orders/"+oid,undefined,other)).status,404);
      const checkout=await req("/api/orders/"+oid+"/checkout-options",{addonServiceIds:["identity"],amount:1});
      assert.equal(checkout.status,200);assert.equal(checkout.data.subtotal,expected+69000);
      const q=checkout.data.contracts.at(-1),summary=q.document.sections.find(s=>s.title==="خيارات صناعة المحتوى والسعر");
      assert.match(summary.body,/رسمي بسيط بألوان الهوية/);assert.match(summary.body,/client-materials/);
      assert.ok(summary.body.includes((expected/100).toFixed(2)));
      assert.equal(q.deliveryDate,null);assert.equal(q.document.details.revisions,2);
      assert.equal((await req("/api/orders/"+oid+"/accept",{accept:true,contractId:q.id})).status,200);
      const fetched=await req("/api/orders/"+oid);
      assert.deepEqual(fetched.data.contentProduction,created.data.contentProduction);
      assert.equal(fetched.data.contracts.at(-1).fingerprint,q.fingerprint);
    }
  } finally {
    if(app){await new Promise(done=>app.server.close(done));await app.db.close();}
    for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];
    Object.assign(process.env,env);await rm(dir,{recursive:true,force:true});
  }
});
