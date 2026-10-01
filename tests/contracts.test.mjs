import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContractDetails, createContractDocument, contractMetadata } from "../lib/contracts.js";
import { contractDetailsFixture } from "./contract-fixture.mjs";

test("new contracts require structured details and enforce every input boundary", () => {
  for (const value of [undefined, null, [], {}, { provider: [] }])
    assert.throws(() => validateContractDetails(value), { status: 400 });
  const invalid = [
    ["provider.legalName", "a"], ["provider.legalName", "a".repeat(151)],
    ["provider.address", "short"], ["provider.address", "a".repeat(501)],
    ["provider.registrationNumber", "a".repeat(81)],
    ["provider.registrationType", "trade_certificate"],
    ["provider.activity", "a".repeat(201)],
    ["deliverables", "short"], ["deliverables", "a".repeat(5001)],
    ...["exclusions", "clientRequirements", "thirdPartyCosts", "ownership", "cancellation"]
      .flatMap((key) => [[key, "short"], [key, "a".repeat(3001)]]),
    ["revisions", -1], ["revisions", 21], ["revisions", 1.5], ["revisions", "2"],
    ["reviewDays", 0], ["reviewDays", 31], ["supportDays", -1], ["supportDays", 366],
  ];
  for (const [path, value] of invalid) {
    const fixture = structuredClone(contractDetailsFixture);
    const keys = path.split(".");
    if (keys.length === 2) fixture[keys[0]][keys[1]] = value;
    else fixture[path] = value;
    assert.throws(() => validateContractDetails(fixture), { status: 400 }, path);
  }
  const limits = structuredClone(contractDetailsFixture);
  limits.revisions = 0; limits.reviewDays = 1; limits.supportDays = 0;
  delete limits.provider.registrationNumber;
  delete limits.provider.registrationType;
  delete limits.provider.activity;
  const minimum = validateContractDetails(limits);
  assert.equal(minimum.provider.registrationNumber, "");
  assert.equal(minimum.provider.registrationType, "none");
  assert.equal(minimum.provider.activity, "");
  limits.revisions = 20; limits.reviewDays = 30; limits.supportDays = 365;
  assert.equal(validateContractDetails(limits).supportDays, 365);
});

test("contract documents snapshot details and preserve review, cancellation and licensing rights", () => {
  const fixture = structuredClone(contractDetailsFixture);
  fixture.provider.registrationType = "freelance_certificate";
  fixture.provider.registrationNumber = "FL-TEST-ONLY";
  const details = validateContractDetails(fixture);
  const context = {
    agreement: "نطاق خدمة اختبار مفصل حسب المخرجات المحددة.",
    terms: "شروط خاصة للاختبار لا تنفذ معاملة مالية.",
    contact: { email: "test@example.test", phone: "+966500000000" },
    customer: { name: "عميل اختبار", email: "customer@example.test" },
    subtotal: 100000, discount: 20000, amount: 80000,
    promotion: { code: "ANTLAQH20" }, deliveryDate: "2037-01-01",
  };
  const doc = createContractDocument(details, context);
  assert.equal(doc.schemaVersion, contractMetadata.schemaVersion);
  assert.equal(doc.policyVersion, "2026-10-01");
  assert.deepEqual(doc.details, details);
  details.deliverables = "Changed after snapshot";
  assert.equal(doc.details.deliverables, fixture.deliverables);
  const all = doc.sections.map((section) => section.title + "\n" + section.body).join("\n");
  assert.match(all, /شهادة العمل الحر/);
  assert.doesNotMatch(doc.sections[0].body, /رقم السجل التجاري/);
  assert.match(all, /تحويل بنكي فقط/);
  assert.match(all, /لا يعد موافقة صامتة/);
  assert.match(all, /سبعة أيام/);
  assert.match(all, /خمسة عشر يومًا/);
  assert.match(all, /لا يفترض أن تخصيص الموقع يلغي حق الإلغاء/);
  assert.match(all, /20[0-9]\.00 ر\.س/);
  assert.match(all, /تراخيص للطرف الثالث/);
  assert.ok(doc.sections.every((section) => typeof section.title === "string" && typeof section.body === "string" && section.body.length));
});
