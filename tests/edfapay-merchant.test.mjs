import test from 'node:test';
import assert from 'node:assert/strict';
import {createEdfapayCheckout} from '../lib/edfapay-checkout.js';
test('non-2xx merchant rejection preserves only safe provider codes and field names',async()=>{
 const billing={firstName:'Test',lastName:'User',address:'Street',city:'Riyadh',zip:'12345',country:'SA'};
 for (const response of [
  {ok:false,status:400,json:async()=>({result:'ERROR',error_code:204002,error_message:'secret customer address'})},
  {ok:false,status:422,json:async()=>({result:'ERROR',error_code:100000,errors:[{error_message:'payer_zip: secret address'},{error_message:'unknown_secret: private password'},{error_message:'payer_zip: duplicate'}]})},
  {ok:false,status:500,json:async()=>{throw Error('secret html');}},
  {ok:false,status:403,json:async()=>({redirect_url:'https://pay.edfapay.com/test'})}
 ]) {
  const checkout=createEdfapayCheckout({env,request:async()=>response});
  await assert.rejects(checkout.initiate({order,providerOrderId:'INT-TEST-ABC12345',billing,payerIp:'127.0.0.1'}),error=>{
   assert.equal(error.status,502); assert.doesNotMatch(error.message,/secret|private|password|unknown_secret/);
   if(response.status===400) assert.match(error.message,/204002/);
   if(response.status===422) assert.match(error.message,/100000.*payer_zip/);
   if(response.status===500) assert.match(error.message,/HTTP 500/);
   if(response.status===403) assert.match(error.message,/معرف التاجر/);
   return true;
  });
 }
});
const env={NODE_ENV:'test',APP_URL:'https://antlaqh.test',EDFAPAY_MERCHANT_ID:'12345678-1234-1234-1234-123456789012',EDFAPAY_MERCHANT_PASSWORD:'test-only-password',EDFAPAY_API_KEY:'unrelated-profile-secret'};
const order={id:'a'.repeat(36),number:'INT-TEST',status:'awaiting_payment',amount:29900,customer:{name:'Test User',email:'test@example.test',phone:'0551234567'},currentContract:'c',contracts:[{id:'c',acceptedAt:'2026-10-04'}]};
test('merchant checkout keeps secrets server-side and uses authoritative amount',async()=>{let sent;const c=createEdfapayCheckout({env,request:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({redirect_url:'https://pay.edfapay.com/checkout/test'})};}});assert.equal(c.readiness.integration,'merchant');assert.doesNotMatch(JSON.stringify(c.readiness),/test-only-password|unrelated-profile-secret/);await c.initiate({order,providerOrderId:'INT-TEST-ABC12345',billing:{firstName:'Test',lastName:'User',address:'Test street',city:'Riyadh',zip:'12345',country:'SA'},payerIp:'127.0.0.1'});assert.equal(sent.url,'https://api.edfapay.com/payment/initiate');assert.equal(sent.options.body.get('order_amount'),'299.00');assert.equal(sent.options.body.get('auth'),'N');assert.equal(sent.options.headers['X-API-KEY'],undefined);assert.doesNotMatch(JSON.stringify([...sent.options.body]),/test-only-password|unrelated-profile-secret/);assert.equal(sent.options.body.get('hash'),'f0331773ae0f1d7b753c29b1d51338d4c9cd51e8');});
test('merchant checkout rejects missing billing before a network request',async()=>{let calls=0;const c=createEdfapayCheckout({env,request:async()=>{calls++;}});await assert.rejects(c.initiate({order,providerOrderId:'INT-TEST-ABC12345',payerIp:'127.0.0.1'}),{status:400});assert.equal(calls,0);});
test('merchant checkout refuses disabled credentials and attacker redirect',async()=>{const disabled=createEdfapayCheckout({env:{...env,EDFAPAY_CHECKOUT_ENABLED:'false'}});assert.equal(disabled.readiness.configured,false);const billing={firstName:'Test',lastName:'User',address:'Street',city:'Riyadh',zip:'12345',country:'SA'};const c=createEdfapayCheckout({env,request:async()=>({ok:true,json:async()=>({redirect_url:'https://edfapay.com.attacker.test/pay'})})});await assert.rejects(c.initiate({order,providerOrderId:'INT-TEST-ABC12345',billing,payerIp:'127.0.0.1'}),{status:502});await assert.rejects(c.initiate({order:{...order,payment:{confirmed:true}},providerOrderId:'INT-TEST-ABC12345',billing,payerIp:'127.0.0.1'}),{status:409});});
