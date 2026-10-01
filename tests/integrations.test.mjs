import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../public/integrations.js",import.meta.url),"utf8");
async function integration(consent,hash) {
  const scripts=[],events={},panels=[];
  const location={origin:"https://antlaqh.com",hash};
  const window={addEventListener:(name,fn)=>events[name]=fn};
  const context=vm.createContext({window,location,Date,encodeURIComponent,fetch:async()=>({ok:true,json:async()=>({integrations:{ga4MeasurementId:"G-TEST12345"}})}),localStorage:{getItem:()=>consent,setItem(){}},document:{querySelector:()=>null,createElement:()=>({setAttribute(){}}),head:{append:s=>scripts.push(s)},body:{append:p=>panels.push(p)},addEventListener(){}}});
  await new vm.Script(`(async()=>{${source}})()`).runInContext(context);
  return {scripts,window,location,events,panels};
}
test("Analytics loads no Google script when consent is absent or rejected",async()=>{
  const pending=await integration(null,"#/services");
  assert.equal(pending.scripts.length,0);
  assert.equal(pending.panels.length,1);
  assert.equal((await integration("rejected","#/services")).scripts.length,0);
});
test("accepted analytics strips personal URL parameters and disables tracking on private routes",async()=>{
  const i=await integration("accepted","#/services?email=private@example.test&order=private");
  assert.equal(i.scripts.length,1);
  const sent=i.window.dataLayer.map(args=>Array.from(args));
  const view=sent.find(args=>args[0]==="event"&&args[1]==="page_view");
  assert.equal(view[2].page_location,"https://antlaqh.com/#/services");
  assert.doesNotMatch(JSON.stringify(sent),/private@example|order=private/);
  i.location.hash="#/order/private-id?secret=abc";
  i.events.hashchange();
  assert.equal(i.window["ga-disable-G-TEST12345"],true);
  assert.equal(i.window.dataLayer.length,sent.length);
  assert.equal((await integration("accepted","#/profile")).scripts.length,0);
});
