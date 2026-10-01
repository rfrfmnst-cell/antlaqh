import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { id, digest } from "../lib/security.js";
import { contractDetailsFixture } from "./contract-fixture.mjs";

test("new API contracts require details, snapshot complete versions, and keep legacy contracts unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-contracts-"));
  const savedEnv = { ...process.env };
  let app;
  Object.assign(process.env, {
    NODE_ENV: "test", PORT: "0", APP_URL: "http://localhost:39997", DATA_DIR: dir, DB_DRIVER: "sqlite",
    OPENAI_API_KEY: "", TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", TWILIO_VERIFY_SERVICE_SID: "",
    BOOTSTRAP_ADMIN_EMAIL: "", BOOTSTRAP_ADMIN_PASSWORD: "", GOOGLE_ANALYTICS_ID: "",
    BUSINESS_LEGAL_NAME: "", BUSINESS_ADDRESS: "", BUSINESS_REGISTRATION_NUMBER: "",
    BUSINESS_REGISTRATION_TYPE: "", BUSINESS_ACTIVITY: "",
  });
  try {
    app = await import("../server.js?contracts=" + randomBytes(6).toString("hex"));
    if (!app.server.listening) await new Promise((done) => app.server.once("listening", done));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    async function actor(role) {
      const uid = id(), token = id(), csrf = id();
      await app.db.insert("user", {
        id: uid, name: role === "admin" ? "مسؤول اختبار" : "عميل اختبار",
        email: `${role}@example.test`, role, password: "unused-test-fixture", createdAt: new Date().toISOString(),
      }, uid);
      await app.db.insert("session", { id: digest(token), userId: uid, csrf, expires: Date.now() + 86400000, passwordVersion: 0 }, uid);
      return { id: uid, cookie: `antlaqh_session=${token}`, csrf };
    }
    const admin = await actor("admin"), customer = await actor("customer");
    async function request(path, body, as) {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { ...(body === undefined ? {} : { Origin: "http://localhost:39997", "Content-Type": "application/json" }),
          ...(as ? { Cookie: as.cookie, "X-CSRF-Token": as.csrf } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }
    assert.deepEqual((await request("/api/config")).data.contracts, { schemaVersion: 2, policyVersion: "2026-10-01", required: true });
    assert.equal((await request("/api/admin/contract-provider")).status, 401);
    assert.equal((await request("/api/admin/contract-provider", undefined, customer)).status, 403);
    assert.deepEqual((await request("/api/admin/contract-provider", undefined, admin)).data, {
      legalName: "", address: "", registrationNumber: "", registrationType: "none", activity: "",
    });
    process.env.BUSINESS_REGISTRATION_TYPE = "freelance_certificate";
    process.env.BUSINESS_REGISTRATION_NUMBER = "FL-SYNTHETIC-ONLY";
    process.env.BUSINESS_ACTIVITY = "نشاط اختبار اصطناعي";
    assert.equal((await request("/api/admin/contract-provider", undefined, admin)).data.registrationType, "freelance_certificate");
    assert.equal((await request("/api/config")).data.registrationNumber, undefined);
    const order = (await request("/api/orders", {
      type: "service", service: "website", title: "اختبار إصدار عقد", description: "طلب محلي للاختبار والتحقق من مستند العقد فقط.",
    }, customer)).data;
    const quote = { agreement: "تنفيذ صفحات المشروع وفق النطاق المحدد في هذا الاختبار.", amount: 100000,
      deliveryDate: "2037-01-01", terms: "شروط الاختبار الخاصة دون معاملة مالية حقيقية." };
    const path = `/api/orders/${order.id}/quote`;
    assert.equal((await request(path, quote, customer)).status, 403);
    assert.equal((await request(path, quote, admin)).status, 400);
    assert.equal((await app.db.get("order", order.id)).contracts.length, 0);
    const legacy = { id: id(), version: 1, agreement: "نص عقد قديم محفوظ", amount: 90000, terms: "شروط العقد القديم",
      acceptedAt: "2026-01-01T00:00:00.000Z", fingerprint: digest("Legacy snapshot") };
    await app.db.update("order", order.id, (value) => { value.contracts.push(legacy); value.currentContract = legacy.id; return value; });
    const details = structuredClone(contractDetailsFixture);
    details.provider.registrationType = "freelance_certificate";
    details.provider.registrationNumber = "FL-SYNTHETIC-ONLY";
    let response = await request(path, { ...quote, contractDetails: details }, admin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.contracts[0], legacy);
    const issued = response.data.contracts[1];
    assert.equal(issued.version, 2);
    assert.equal(issued.document.schemaVersion, 2);
    assert.deepEqual(issued.document.details, details);
    assert.equal(issued.parties.provider, details.provider.legalName);
    assert.equal(issued.providerDetails.registrationType, "freelance_certificate");
    const hashed = { id: issued.id, version: issued.version, agreement: issued.agreement,
      subtotal: issued.subtotal, discount: issued.discount, amount: issued.amount,
      promotion: issued.promotion, deliveryDate: issued.deliveryDate, terms: issued.terms,
      parties: issued.parties, providerDetails: issued.providerDetails, document: issued.document, currency: issued.currency };
    assert.equal(issued.fingerprint, digest(JSON.stringify(hashed)));
    const changedHash = structuredClone(hashed);
    changedHash.document.details.deliverables = "Changed document";
    assert.notEqual(issued.fingerprint, digest(JSON.stringify(changedHash)));
    details.deliverables = "مخرجات الإصدار الجديد مستقلة عن الإصدار السابق المحفوظ.";
    response = await request(path, { ...quote, amount: 200000, contractDetails: details }, admin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.contracts[0], legacy);
    assert.deepEqual(response.data.contracts[1], issued);
    assert.equal(response.data.contracts[2].document.details.deliverables, details.deliverables);
    assert.equal((await request(`/api/orders/${order.id}/accept`, { accept: true, contractId: issued.id }, customer)).status, 409);
    response = await request(`/api/orders/${order.id}/accept`, { accept: true, contractId: response.data.currentContract }, customer);
    assert.equal(response.status, 200);
    const accepted = response.data.contracts[2];
    assert.equal(accepted.acceptance.fingerprint, accepted.fingerprint);
    assert.equal(accepted.document.details.deliverables, details.deliverables);
  } finally {
    if (app) { app.server.closeAllConnections(); await new Promise((done) => app.server.close(done)); await app.db.close(); }
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
  }
});
