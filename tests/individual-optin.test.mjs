import test from "node:test";
import assert from "node:assert/strict";
import { parseSignup, parseVerification, CONSENT_VERSION } from "../lib/individual-optin.js";

const valid = { phone: "0551234567", name: "خالد", city: "جدة", carrierClaim: "stc",
  interest: "offers", whatsappUser: true, marketingConsent: true, website: "" };

test("individual subscription requires explicit marketing and WhatsApp confirmation", () => {
  assert.throws(() => parseSignup({ ...valid, marketingConsent: false }));
  assert.throws(() => parseSignup({ ...valid, whatsappUser: false }));
});
test("normalizes valid Saudi phone without claiming actual network provider", () => {
  assert.equal(parseSignup(valid).phone, "+966551234567");
  assert.equal(parseSignup(valid).carrierClaim, "stc");
  assert.match(CONSENT_VERSION, /^2026/);
});
test("rejects international numbers and unwanted categories and bot input", () => {
  assert.throws(() => parseSignup({ ...valid, phone: "+447700900123" }));
  assert.throws(() => parseSignup({ ...valid, interest: "all-data" }));
  assert.throws(() => parseSignup({ ...valid, carrierClaim: "fake" }));
  assert.throws(() => parseSignup({ ...valid, website: "bot" }));
});
test("OTP code must be numeric and belongs to the same normalized phone", () => {
  assert.deepEqual(parseVerification({ phone: valid.phone, code: "123456" }),
    { phone: "+966551234567", code: "123456" });
  assert.throws(() => parseVerification({ phone: valid.phone, code: "xxxxxx" }));
});
