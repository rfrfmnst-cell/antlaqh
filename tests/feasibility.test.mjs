import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {id, digest, validFile} from '../lib/security.js';
import {studyPlans, validateStudy, requiredStudyDocuments} from '../lib/feasibility.js';
const answers = {depth:'detailed',purpose:'financing',stage:'existing',activity:'مصنع أثاث للاختبار',city:'نجران',customers:'منتجات أثاث للعملاء والشركات المحلية',operations:'مساحة 400 متر وخمسة موظفين ومعدات تصنيع',costs:'المعدات 100000 ريال والإيجار 5000 شهريًا',sales:'سعر الوحدة 800 ريال و100 وحدة شهريًا',capital:'200000 ريال',fundingEntity:'جهة تمويل اختبار',fundingAmount:'100000 ريال ومساهمة ذاتية 100000',fundingRequirements:'نموذج الجهة وتوقعات مالية لخمس سنوات'};
test('study choices validate inputs and ignore client supplied plan/prices',()=>{
  for (const plan of studyPlans) {
    const study = validateStudy({...answers,depth:plan.depth,purpose:plan.purpose,plan:{amount:1},amount:1});
    assert.equal(study.plan.amount,plan.amount);
    assert.notEqual(study.plan,plan);
  }
  assert.throws(()=>validateStudy({...answers,depth:'anything'}),{status:400});
  assert.throws(()=>validateStudy({...answers,fundingEntity:''}),{status:400});
  assert.throws(()=>validateStudy({...answers,costs:''}),{status:400});
  assert.deepEqual(requiredStudyDocuments(validateStudy({...answers,purpose:'personal',stage:'new'})).map(d=>d.id),['project','quotations','financial']);
});
function zipDirectory(names) {
  let offset=0; const local=[], central=[];
  for(const name of names){
    const n=Buffer.from(name), l=Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(n.length,26);
    const c=Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(n.length,28); c.writeUInt32LE(offset,42);
    local.push(l,n);central.push(c,n);offset+=l.length+n.length;
  }
  const cd=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,cd,end]);
}
test('spreadsheet uploads are restricted to study attachments and reject unsafe or invalid formats',()=>{
  const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const xlsx=zipDirectory(['[Content_Types].xml','xl/workbook.xml']);
  assert.doesNotThrow(()=>validFile(xlsx,mime,true));
  assert.throws(()=>validFile(xlsx,mime),{status:400});
  for(const names of [['random.txt'],['[Content_Types].xml','xl/workbook.xml','xl/vbaProject.bin'],['[Content_Types].xml','xl/workbook.xml','../bad']]) assert.throws(()=>validFile(zipDirectory(names),mime,true),{status:400});
  for(let n=0;n<200;n++) assert.throws(()=>validFile(randomBytes(n),mime,true),{status:400});
  assert.doesNotThrow(()=>validFile(Buffer.from('المنتج,السعر\nأثاث,800\n'),'text/csv',true));
  assert.throws(()=>validFile(Buffer.from([255,254,0]),'text/csv',true),{status:400});
});
test('study purchase prices all four plans, snapshots scope, authorizes documents, and gates execution',async()=>{
  const env={...process.env},dir=await mkdtemp(join(tmpdir(),'antlaqh-study-'));let app;
  Object.assign(process.env,{NODE_ENV:'test',PORT:'0',APP_URL:'http://localhost:39996',DATA_DIR:dir,DB_DRIVER:'sqlite',OPENAI_API_KEY:'',TWILIO_ACCOUNT_SID:'',BOOTSTRAP_ADMIN_EMAIL:'',BOOTSTRAP_ADMIN_PASSWORD:''});
  try {
    app=await import('../server.js?study='+randomBytes(6).toString('hex'));
    if(!app.server.listening) await new Promise(done=>app.server.once('listening',done));
    const base='http://127.0.0.1:'+app.server.address().port;
    async function actor(role,suffix=''){
      const uid=id(),token=id(),csrf=id();await app.db.insert('user',{id:uid,name:'اختبار دراسة الجدوى',email:role+suffix+'@example.test',role,createdAt:new Date().toISOString()},uid);
      await app.db.insert('session',{id:digest(token),userId:uid,csrf,expires:Date.now()+86400000,passwordVersion:0},uid);
      return {cookie:'antlaqh_session='+token,csrf};
    }
    const customer=await actor('customer'),other=await actor('customer','2'),admin=await actor('admin');
    async function req(path,body,as=customer,extra={}){
      const raw=Buffer.isBuffer(body);const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:'http://localhost:39996','Content-Type':raw?'application/pdf':'application/json'}),Cookie:as.cookie,'X-CSRF-Token':as.csrf,...extra},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
      return {status:r.status,data:(r.headers.get('content-type')||'').includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())};
    }
    assert.equal((await req('/api/orders',{service:'feasibility',title:'اختبار دراسة',description:'بيانات المشروع للاختبار فقط',study:{...answers,depth:'bad'}})).status,400);
    for(const plan of studyPlans){
      const created=await req('/api/orders',{service:'feasibility',title:'اختبار دراسة جدوى',description:'هذه بيانات مشروع وهمي لاختبار رحلة الخدمة.',study:{...answers,depth:plan.depth,purpose:plan.purpose,plan:{amount:1}},amount:1});assert.equal(created.status,201);
      const oid=created.data.id,path='/api/orders/'+oid;
      assert.equal(created.data.advertisedPrice.from,plan.amount);
      assert.equal((await req(path+'/checkout-options',{})).status,409);
      const docInput=Object.fromEntries(requiredStudyDocuments(created.data.study).map(d=>[d.id,{status:'pending',note:'سأستكمل الملف مع الفريق قبل التنفيذ'}]));
      assert.equal((await req(path+'/study-documents',{documents:docInput},other)).status,404);
      const falseAttached={...docInput,quotations:{status:'attached'}};
      assert.equal((await req(path+'/study-documents',{documents:falseAttached})).status,400);
      const uploaded=await req(path+'/files',Buffer.from('%PDF-1.4\nTest only'),customer,{'X-File-Name':'test-quotes.pdf','X-Study-Category':'quotations'});
      assert.equal(uploaded.status,201);const fid=uploaded.data.files[0].id;
      assert.equal((await req(path+'/files/'+fid,undefined,other)).status,404);
      assert.equal((await req(path+'/files/'+fid,undefined,admin)).status,200);
      docInput.quotations={status:'attached',note:''};
      assert.equal((await req(path+'/study-documents',{documents:docInput})).status,200);
      const quoted=await req(path+'/checkout-options',{addonServiceIds:['consulting'],amount:1});assert.equal(quoted.status,200);
      assert.equal(quoted.data.subtotal,plan.amount+14900);
      const q=quoted.data.contracts.at(-1);
      assert.equal(q.document.details.revisions,plan.revisions);
      assert.match(q.document.sections.find(s=>s.title==='خطة دراسة الجدوى وبياناتها').body,/نجران/);
      assert.ok(q.document.details.deliverables.includes(plan.includes.at(-1)));
      assert.equal(q.deliveryDate,null);
      assert.equal(quoted.data.study.documents.find(d=>d.id==='quotations').fileIds[0],fid);
      assert.equal((await req(path+'/accept',{accept:true,contractId:q.id})).status,200);
      assert.equal((await req(path+'/confirm-payment',{reference:'TEST-ONLY-NO-PAYMENT'},admin)).status,200);
      assert.equal((await req(path+'/status',{status:'in_progress'},admin)).status,409);
      assert.equal((await req(path+'/study-ready',{reviewed:true})).status,403);
      assert.equal((await req(path+'/study-ready',{reviewed:true},admin)).status,200);
      assert.equal((await req(path+'/status',{status:'in_progress'},admin)).status,200);
      assert.equal((await req(path)).data.contracts[0].fingerprint,q.fingerprint);
    }
    const personal=await req('/api/orders',{service:'feasibility',title:'اختبار ملف إكسل',description:'طلب جديد لاختبار رفع ملف إكسل بأمان.',study:{...answers,purpose:'personal',stage:'new'}});
    assert.equal((await req('/api/orders/'+personal.data.id+'/files',Buffer.from('item,cost\nchair,800\n'),customer,{'Content-Type':'text/csv','X-File-Name':'pricing.csv','X-Study-Category':'financial'})).status,201);
  } finally {if(app){await new Promise(done=>app.server.close(done));await app.db.close();} for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);await rm(dir,{recursive:true,force:true});}
});
