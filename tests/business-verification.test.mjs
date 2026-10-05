import test from "node:test";
import assert from "node:assert/strict";
import { businessVerification } from "../lib/business-verification.js";
test("a work document number alone never represents store authentication",()=>{
  const v=businessVerification({BUSINESS_WORK_DOCUMENT_NUMBER:"FL-716389163"});
  assert.equal(v.documentNumber,"FL-716389163");assert.equal(v.verified,false);assert.equal(v.certificateUrl,"");
});
test("store badge requires a certificate number and a direct HTTPS official certificate URL",()=>{
  const env={BUSINESS_ECOMMERCE_CERTIFICATE_NUMBER:"0000001234",BUSINESS_ECOMMERCE_CERTIFICATE_URL:"https://eauthenticate.saudibusiness.gov.sa/inquiry/details/example"};
  assert.equal(businessVerification(env).verified,true);
  for(const url of ["https://example.test/certificate","http://eauthenticate.saudibusiness.gov.sa/certificate","https://eauthenticate.saudibusiness.gov.sa.evil.test/certificate","javascript:alert(1)","https://eauthenticate.saudibusiness.gov.sa/inquiry","https://user:pass@business.sa/certificate",""]) assert.equal(businessVerification({...env,BUSINESS_ECOMMERCE_CERTIFICATE_URL:url}).verified,false);
  assert.equal(businessVerification({...env,BUSINESS_ECOMMERCE_CERTIFICATE_NUMBER:""}).verified,false);
  assert.equal(businessVerification({BUSINESS_WORK_DOCUMENT_NUMBER:"<img src=x>"}).documentNumber,"");
});
