import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createStore } from "../lib/store.js";
import { createRecovery } from "../lib/recovery.js";
import { id, digest, checkPassword } from "../lib/security.js";

const smtpEnv = {
  APP_URL: "https://example.test", RECOVERY_EMAIL_ENABLED: "true",
  SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_SECURE: "false",
  SMTP_USER: "synthetic", SMTP_PASSWORD: "synthetic-only", RECOVERY_FROM_EMAIL: "support@example.test",
};
const whatsappEnv = {
  RECOVERY_WHATSAPP_ENABLED: "true", TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
  TWILIO_AUTH_TOKEN: "synthetic-only", TWILIO_VERIFY_SERVICE_SID: "VA" + "b".repeat(32),
};
const status = (value) => (error) => error.status === value;
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-recovery-"));
  let db = await createStore({ driver: "sqlite", dir });
  let time = Date.parse("2026-10-01T00:00:00Z");
  t.after(async () => {
    await db.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
  });
  return { get db() { return db; }, clock: () => time, advance: (ms) => { time += ms; },
    restart: async () => { await db.close(); db = await createStore({ driver: "sqlite", dir }); },
    user: async (mail, extra = {}) => {
      const user = { id: digest(mail), email: mail, name: "عميل اختبار", role: "customer",
        password: "previous-hash-fixture", phoneVerified: false, ...extra };
      await db.insert("user", user, user.id);
      return user;
    },
  };
}
function providers() {
  const mail = [], calls = [];
  const sent = new Map();
  const transport = { verify: async () => true, sendMail: async (message) => { mail.push(message); return {}; } };
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, data: options.body ? Object.fromEntries(options.body) : null });
    if (options.method === "GET") return { ok: true, json: async () => ({ whatsapp: { msg_service_sid: "MG" + "c".repeat(32) } }) };
    if (url.endsWith("Verifications")) {
      const sid = "VE" + id().slice(0, 32), verification = { sid, channel: "whatsapp", to: options.body.get("To"), status: "pending" };
      sent.set(sid, verification);
      return { ok: true, json: async () => verification };
    }
    return { ok: true, json: async () => ({ ...sent.get(options.body.get("VerificationSid")),
      status: options.body.get("Code") === "012345" ? "approved" : "pending" }) };
  };
  return { mail, calls, transport, fetchImpl };
}
const emailToken = (message) => {
  const url = new URL(message.text.match(/https:\/\/[^\s]+/)[0]);
  return { url, token: new URLSearchParams(url.hash.split("?")[1]).get("token") };
};

test("recovery readiness requires explicit gates, verified SMTP and a WhatsApp Verify binding", async (t) => {
  const f = await fixture(t), p = providers();
  let recovery = await createRecovery({ db: f.db, env: {}, transport: p.transport, fetchImpl: p.fetchImpl });
  assert.deepEqual(recovery.readiness, { emailReady: false, whatsappReady: false });
  await assert.rejects(recovery.request({ channel: "email", identifier: "unknown@example.test" }), status(503));
  await assert.rejects(recovery.verify({ challengeId: id(), code: "012345" }), status(503));
  assert.equal(p.calls.length, 0);
  assert.equal(p.mail.length, 0);
  recovery = await createRecovery({ db: f.db, env: { ...smtpEnv, APP_URL: "http://unsafe.test" }, transport: p.transport });
  assert.equal(recovery.readiness.emailReady, false);
  recovery = await createRecovery({ db: f.db, env: { ...smtpEnv, SMTP_PORT: "465" }, transport: p.transport });
  assert.equal(recovery.readiness.emailReady, false);
  recovery = await createRecovery({ db: f.db, env: smtpEnv, transport: { verify: async () => { throw new Error("provider-secret"); } } });
  assert.equal(recovery.readiness.emailReady, false);
  await assert.rejects(recovery.request({ channel: "email", identifier: "unknown@example.test" }), (error) => error.status === 503 && !error.message.includes("provider-secret"));
  recovery = await createRecovery({ db: f.db, env: whatsappEnv,
    fetchImpl: async () => ({ ok: true, json: async () => ({ whatsapp: {} }) }) });
  assert.equal(recovery.readiness.whatsappReady, false);
  recovery = await createRecovery({ db: f.db, env: whatsappEnv, fetchImpl: p.fetchImpl });
  assert.equal(recovery.readiness.whatsappReady, true);
  assert.equal(p.calls[0].method, "GET");
});

test("email requests conceal account existence, store only hashed tokens and persist a single-use reset", async (t) => {
  const f = await fixture(t), p = providers(), user = await f.user("customer@example.test");
  const oldOrder = { id: id(), owner: user.id, contracts: [{ agreement: "نص العقد القديم" }], payment: { amount: 1200 } };
  await f.db.insert("order", oldOrder, user.id);
  const recovery = await createRecovery({ db: f.db, env: smtpEnv, clock: f.clock, transport: p.transport });
  const known = await recovery.request({ channel: "email", identifier: "CUSTOMER@example.test" });
  const unknown = await recovery.request({ channel: "email", identifier: "missing@example.test" });
  assert.equal(known.message, unknown.message);
  assert.deepEqual(Object.keys(known), ["challengeId", "message"]);
  assert.match(known.challengeId, /^[a-f0-9]{36}$/);
  assert.match(unknown.challengeId, /^[a-f0-9]{36}$/);
  assert.notEqual(known.challengeId, unknown.challengeId);
  await recovery.settled();
  assert.equal(p.mail.length, 1);
  assert.equal(p.mail[0].to, user.email);
  const { url, token } = emailToken(p.mail[0]);
  assert.equal(url.origin, smtpEnv.APP_URL);
  assert.match(url.hash, /^#\/reset-password\?token=/);
  assert.match(token, /^[a-f0-9]{64}$/);
  const record = await f.db.get("recoveryToken", digest(token));
  assert.equal(record.purpose, "recovery");
  assert.equal(record.expires - f.clock(), 1800000);
  assert.equal(JSON.stringify(await f.db.list("recoveryToken")).includes(token), false);
  await assert.rejects(recovery.reset({ token, password: "short" }), status(400));
  assert.equal((await f.db.get("recoveryToken", digest(token))).used, false);
  await f.restart();
  const restarted = await createRecovery({ db: f.db, env: smtpEnv, clock: f.clock, transport: p.transport });
  const password = "A-new-private-password-123";
  const results = await Promise.allSettled([restarted.reset({ token, password }), restarted.reset({ token, password })]);
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  assert.equal(results.find((value) => value.status === "rejected").reason.status, 400);
  const changed = await f.db.get("user", user.id);
  assert.equal(changed.authVersion, 1);
  assert.equal(changed.passwordVersion, 1);
  assert.equal(changed.email, user.email);
  assert.equal(await checkPassword(password, changed.password), true);
  assert.notEqual(changed.password, password);
  assert.deepEqual(await f.db.get("order", oldOrder.id), oldOrder);
  await assert.rejects(restarted.reset({ token, password }), status(400));
});

test("email tokens expire, reject another purpose and roll back if the user write fails", async (t) => {
  const f = await fixture(t), p = providers(), user = await f.user("expiry@example.test");
  const recovery = await createRecovery({ db: f.db, env: smtpEnv, clock: f.clock, transport: p.transport });
  const requestToken = async () => {
    await recovery.request({ channel: "email", identifier: user.email });
    await recovery.settled();
    return emailToken(p.mail.at(-1)).token;
  };
  let token = await requestToken();
  f.advance(1800000);
  await assert.rejects(recovery.reset({ token, password: "New-password-value-123" }), status(400));
  token = await requestToken();
  await f.db.update("recoveryToken", digest(token), (value) => { value.purpose = "login"; return value; });
  await assert.rejects(recovery.reset({ token, password: "New-password-value-123" }), status(400));
  token = await requestToken();
  const updateMany = f.db.updateMany;
  f.db.updateMany = (updates, inserts) => updateMany(updates.map((entry) => entry.kind === "user"
    ? { ...entry, fn: () => { throw Object.assign(new Error("Account write failure"), { status: 503 }); } } : entry), inserts);
  await assert.rejects(recovery.reset({ token, password: "New-password-value-123" }), status(503));
  f.db.updateMany = updateMany;
  assert.equal((await f.db.get("recoveryToken", digest(token))).used, false);
  assert.equal((await f.db.get("user", user.id)).password, user.password);
  assert.equal((await recovery.reset({ token, password: "New-password-value-123" })).ok, true);
});

test("WhatsApp requires the stored verified phone, separates purposes and issues one token", async (t) => {
  const f = await fixture(t), p = providers();
  const unverified = await f.user("unverified@example.test", { loginPhone: "+966500000001" });
  await f.db.insert("loginPhone", { id: digest(unverified.loginPhone), userId: unverified.id }, unverified.id);
  const verified = await f.user("verified@example.test", { phone: "+966500000002", phoneVerified: true });
  await f.db.insert("verifiedPhone", { id: digest(verified.phone), userId: verified.id }, verified.id);
  const recovery = await createRecovery({ db: f.db, env: whatsappEnv, clock: f.clock, fetchImpl: p.fetchImpl });
  const unclaimed = await recovery.request({ channel: "whatsapp", identifier: "0500000001" });
  const absent = await recovery.request({ channel: "whatsapp", identifier: "0500000003" });
  const eligible = await recovery.request({ channel: "whatsapp", identifier: "0500000002" });
  assert.equal(unclaimed.message, absent.message);
  assert.equal(absent.message, eligible.message);
  await recovery.settled();
  const sends = p.calls.filter((call) => call.url.endsWith("/Verifications"));
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].data, { To: verified.phone, Channel: "whatsapp" });
  assert.equal(sends[0].data.ChannelConfiguration, undefined);
  assert.equal((await f.db.get("recoveryChallenge", unclaimed.challengeId)).userId, null);
  assert.equal((await f.db.get("recoveryChallenge", eligible.challengeId)).purpose, "recovery");
  const verificationSid = (await f.db.get("recoveryChallenge", eligible.challengeId)).verificationSid;
  assert.match(verificationSid, /^VE[a-f0-9]{32}$/);
  await assert.rejects(recovery.verify({ challengeId: unclaimed.challengeId, code: "012345" }), status(400));
  await assert.rejects(recovery.verify({ challengeId: eligible.challengeId, code: "999999" }), status(400));
  assert.equal((await f.db.get("recoveryChallenge", eligible.challengeId)).attempts, 1);
  assert.deepEqual(p.calls.at(-1).data, { VerificationSid: verificationSid, Code: "999999" });
  assert.equal((await f.db.get("recoveryChallenge", eligible.challengeId)).used, false);
  const results = await Promise.allSettled([
    recovery.verify({ challengeId: eligible.challengeId, code: "012345" }),
    recovery.verify({ challengeId: eligible.challengeId, code: "012345" }),
  ]);
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  const result = results.find((value) => value.status === "fulfilled").value;
  assert.match(result.resetToken, /^[a-f0-9]{64}$/);
  assert.equal(result.expiresIn, 1800);
  assert.equal((await f.db.list("recoveryToken", verified.id)).length, 1);
  assert.equal(JSON.stringify(await f.db.list("recoveryToken")).includes(result.resetToken), false);
  await assert.rejects(recovery.verify({ challengeId: eligible.challengeId, code: "012345" }), status(400));
  const invalidated = await recovery.request({ channel: "whatsapp", identifier: verified.phone });
  await recovery.settled();
  await f.db.update("user", verified.id, (value) => { value.phoneVerified = false; return value; });
  await assert.rejects(recovery.verify({ challengeId: invalidated.challengeId, code: "012345" }), status(400));
  await assert.rejects(recovery.reset({ token: result.resetToken, password: "New-password-value-123" }), status(400));
});

test("recovery throttles normalized identifiers, caps OTP attempts and hides delivery failures", async (t) => {
  const f = await fixture(t), p = providers();
  const verified = await f.user("throttle@example.test", { phone: "+966500000004", phoneVerified: true });
  await f.db.insert("verifiedPhone", { id: digest(verified.phone), userId: verified.id }, verified.id);
  let failed = false;
  const recovery = await createRecovery({ db: f.db, env: { ...smtpEnv, ...whatsappEnv }, clock: f.clock,
    transport: { verify: async () => true, sendMail: async () => { throw new Error("password-secret"); } },
    fetchImpl: async (url, options) => {
      if (failed && options.method === "POST") throw new Error("token-secret");
      return p.fetchImpl(url, options);
    },
  });
  const known = await recovery.request({ channel: "email", identifier: verified.email });
  const unknown = await recovery.request({ channel: "email", identifier: "missing-failure@example.test" });
  assert.equal(known.message, unknown.message);
  await recovery.settled();
  assert.equal((await f.db.list("recoveryToken", verified.id)).length, 0);
  const challenge = await recovery.request({ channel: "whatsapp", identifier: "0500000004" });
  await recovery.settled();
  for (let index = 0; index < 5; index++) await assert.rejects(recovery.verify({ challengeId: challenge.challengeId, code: "999999" }), status(400));
  const count = p.calls.length;
  await assert.rejects(recovery.verify({ challengeId: challenge.challengeId, code: "012345" }), status(400));
  assert.equal(p.calls.length, count);
  await recovery.request({ channel: "whatsapp", identifier: "966500000004" });
  await recovery.request({ channel: "whatsapp", identifier: "+966500000004" });
  await assert.rejects(recovery.request({ channel: "whatsapp", identifier: "0500000004" }), status(429));
  await recovery.settled();
  f.advance(900001);
  failed = true;
  const failedSend = await recovery.request({ channel: "whatsapp", identifier: verified.phone });
  assert.equal(failedSend.message, known.message);
  await recovery.settled();
  assert.equal(await f.db.get("recoveryChallenge", failedSend.challengeId), null);
  await assert.rejects(recovery.verify({ challengeId: failedSend.challengeId, code: "012345" }), (error) => error.status === 400 && !error.message.includes("token-secret"));
});

test("WhatsApp recovery rejects unsent or SMS verifications and removes expired camouflage records", async (t) => {
  const f = await fixture(t), p = providers();
  const user = await f.user("channel@example.test", { phone: "+966500000006", phoneVerified: true });
  await f.db.insert("verifiedPhone", { id: digest(user.phone), userId: user.id }, user.id);
  let unblock, mode = "pending", checks = 0;
  const recovery = await createRecovery({ db: f.db, env: { ...smtpEnv, ...whatsappEnv }, clock: f.clock, transport: p.transport,
    fetchImpl: async (url, options) => {
      if (options.method === "GET") return p.fetchImpl(url, options);
      if (url.endsWith("Verifications")) {
        if (mode === "pending") await new Promise((done) => { unblock = done; });
        return { ok: true, json: async () => ({ sid: "VE" + "e".repeat(32), to: user.phone,
          channel: mode === "sms-send" ? "sms" : "whatsapp", status: "pending" }) };
      }
      checks++;
      return { ok: true, json: async () => mode === "empty" ? null : ({
        sid: mode === "other-sid" ? "VE" + "f".repeat(32) : options.body.get("VerificationSid"),
        to: mode === "other-phone" ? "+966500000099" : user.phone,
        channel: mode === "sms-check" ? "sms" : "whatsapp", status: "approved" }) };
    },
  });
  const pending = await recovery.request({ channel: "whatsapp", identifier: user.phone });
  await assert.rejects(recovery.verify({ challengeId: pending.challengeId, code: "012345" }), status(400));
  assert.equal(checks, 0);
  mode = "sms-check"; unblock(); await recovery.settled();
  await assert.rejects(recovery.verify({ challengeId: pending.challengeId, code: "012345" }), status(400));
  for (const incorrect of ["other-sid", "other-phone", "empty"]) {
    mode = incorrect;
    await assert.rejects(recovery.verify({ challengeId: pending.challengeId, code: "012345" }), status(400));
  }
  assert.equal((await f.db.list("recoveryToken")).length, 0);
  mode = "sms-send";
  const sms = await recovery.request({ channel: "whatsapp", identifier: user.phone });
  await recovery.settled();
  assert.equal(await f.db.get("recoveryChallenge", sms.challengeId), null);
  await assert.rejects(recovery.verify({ challengeId: sms.challengeId, code: "012345" }), status(400));
  const unknown = await recovery.request({ channel: "whatsapp", identifier: "0500000007" });
  await recovery.request({ channel: "email", identifier: "unknown-channel@example.test" });
  const dummyToken = (await f.db.list("recoveryToken"))[0];
  f.advance(1800001);
  await assert.rejects(recovery.verify({ challengeId: pending.challengeId, code: "012345" }), status(400));
  await recovery.request({ channel: "email", identifier: "new-cleanup@example.test" });
  assert.equal(await f.db.get("recoveryChallenge", pending.challengeId), null);
  assert.equal(await f.db.get("recoveryChallenge", unknown.challengeId), null);
  assert.equal(await f.db.get("recoveryToken", dummyToken.id), null);
});
