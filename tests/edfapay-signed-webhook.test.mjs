import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { createEdfapayWebhook } from "../lib/edfapay-webhook.js";

const secret = "webhook-secret-" + "x".repeat(40);
const env = { EDFAPAY_WEBHOOK_ENABLED:"true", EDFAPAY_WEBHOOK_SECRET:secret, APP_URL:"https://example.test" };
const payload = {
  transactionId:"7fcae16d-4035-43e4-806b-87b51881135e",
  orderId:"ANT-TEST-1-PAY001",
  amount:299,
  currencyCode:"682",
  cardScheme:"Mada",
  cardNumber:"4111 **** **** 1111",
  cardToken:"PRIVATE-TOKEN",
  status:"Approved",
  channel:"Payment Gateway",
  type:"Purchase",
  createdAt:"2026-10-04T10:00:00Z",
  finishedAt:"2026-10-04T10:00:05Z",
  merchantId:"7da313e4-5424-4527-befc-53d81c977b1f",
  rrn:"609211300976",
};
function setup(){
  const records=new Map();
  const db={get:async(k,id)=>records.get(id),insert:async(k,item)=>records.set(item.id,item),list:async()=>[...records.values()],remove:async(k,id)=>records.delete(id)};
  return {records,h:createEdfapayWebhook({db,env})};
}
function signedRequest(value=payload,signatureOverride){
  const raw=Buffer.from(JSON.stringify(value));
  const req=Readable.from([raw]);
  req.headers={
    "content-type":"text/plain",
    "x-edfapay-signature":signatureOverride || createHmac("sha256",secret).update(raw).digest("hex"),
  };
  return req;
}
test("signed EdfaPay webhook uses a clean callback URL and rejects invalid signatures",async()=>{
  const {h,records}=setup();
  assert.equal(h.readiness.configured,true);
  assert.equal(h.readiness.signed,true);
  assert.equal(h.readiness.legacy,false);
  assert.equal(h.callbackUrl,"https://example.test/api/webhooks/edfapay");
  await assert.rejects(h.receive(signedRequest(payload,"0".repeat(64)),new URLSearchParams()),{status:403});
  assert.equal(records.size,0);
});
test("signed webhook accepts official text/plain JSON and stores only reconciliation fields",async()=>{
  const {h,records}=setup();
  assert.equal(await h.receive(signedRequest(),new URLSearchParams()),"OK");
  assert.equal(records.size,1);
  const receipt=[...records.values()][0];
  assert.equal(receipt.verified,true);
  assert.equal(receipt.requiresReview,true);
  assert.equal(receipt.status,"APPROVED");
  assert.equal(receipt.action,"PURCHASE");
  assert.equal(receipt.currencyCode,"682");
  assert.equal(receipt.orderNumber,payload.orderId);
  assert.equal(receipt.transactionId,payload.transactionId);
  const serialized=JSON.stringify(receipt);
  assert.doesNotMatch(serialized,/PRIVATE-TOKEN|cardNumber|cardToken|4111/);
});
test("signed webhook is idempotent and validates mandatory reconciliation fields",async()=>{
  const {h,records}=setup();
  await h.receive(signedRequest(),new URLSearchParams());
  await h.receive(signedRequest(),new URLSearchParams());
  assert.equal(records.size,1);
  await assert.rejects(h.receive(signedRequest({...payload,currencyCode:"SAR"}),new URLSearchParams()),{status:400});
  await assert.rejects(h.receive(signedRequest({...payload,orderId:"bad value"}),new URLSearchParams()),{status:400});
  assert.equal(records.size,1);
});
