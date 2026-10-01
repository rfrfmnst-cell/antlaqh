import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { id, digest } from "../lib/security.js";

async function platform(t, enabled) {
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-recovery-api-")), savedEnv = { ...process.env };
  const actualFetch = globalThis.fetch, providerCalls = [], sent = new Map();
  let app;
  Object.assign(process.env, {
    NODE_ENV: "test", PORT: "0", APP_URL: "http://localhost:39996", DATA_DIR: dir, DB_DRIVER: "sqlite",
    OPENAI_API_KEY: "", BOOTSTRAP_ADMIN_EMAIL: "", BOOTSTRAP_ADMIN_PASSWORD: "",
    RECOVERY_EMAIL_ENABLED: "false", RECOVERY_WHATSAPP_ENABLED: enabled ? "true" : "false",
    TWILIO_ACCOUNT_SID: enabled ? "AC" + "a".repeat(32) : "", TWILIO_AUTH_TOKEN: enabled ? "synthetic" : "",
    TWILIO_VERIFY_SERVICE_SID: enabled ? "VA" + "b".repeat(32) : "", BUSINESS_WHATSAPP_PHONE: "+966553575760",
  });
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://verify.twilio.com/")) {
      providerCalls.push({ url, method: options.method, data: options.body ? Object.fromEntries(options.body) : null });
      if (options.method === "GET") return { ok: true, json: async () => ({ whatsapp: { msg_service_sid: "MG" + "c".repeat(32) } }) };
      if (String(url).endsWith("Verifications")) {
        const sid = "VE" + id().slice(0, 32), verification = { sid, channel: "whatsapp", to: options.body.get("To"), status: "pending" };
        sent.set(sid, verification);
        return { ok: true, json: async () => verification };
      }
      return { ok: true, json: async () => ({ ...sent.get(options.body.get("VerificationSid")), status: "approved" }) };
    }
    return actualFetch(url, options);
  };
  t.after(async () => {
    if (app) { app.server.closeAllConnections(); await new Promise((done) => app.server.close(done)); await app.db.close(); }
    globalThis.fetch = actualFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
  });
  app = await import("../server.js?recovery=" + randomBytes(6).toString("hex"));
  if (!app.server.listening) await new Promise((done) => app.server.once("listening", done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, body, cookie) {
    const response = await actualFetch(base + path, { method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { Origin: "http://localhost:39996", "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  return { app, request, providerCalls };
}

test("public recovery routes stay disabled without provider setup and direct WhatsApp stays independent", async (t) => {
  const { request, providerCalls } = await platform(t, false);
  const config = (await request("/api/config")).data;
  assert.deepEqual(config.recovery, { emailReady: false, whatsappReady: false });
  assert.deepEqual(config.channels.whatsapp, { phone: "966553575760", direct: true, automated: false });
  assert.equal((await request("/api/auth/recovery/request", { channel: "email", identifier: "unknown@example.test" })).status, 503);
  assert.equal((await request("/api/auth/recovery/request", { channel: "whatsapp", identifier: "0500000001" })).status, 503);
  assert.equal((await request("/api/auth/recovery/verify", { challengeId: id(), code: "012345" })).status, 503);
  assert.equal((await request("/api/auth/recovery/reset", { token: "a".repeat(64), password: "New-private-password-123" })).status, 503);
  assert.equal(providerCalls.length, 0);
});

test("WhatsApp recovery resets atomically, invalidates every session and preserves customer records", async (t) => {
  const { app, request, providerCalls } = await platform(t, true);
  const mail = "recovered@example.test", uid = digest(mail), first = id(), second = id();
  const user = { id: uid, email: mail, name: "عميل محفوظ", role: "customer", phone: "+966500000005",
    loginPhone: "+966500000005", phoneVerified: true, password: "previous-test-hash", createdAt: "2026-01-01T00:00:00Z" };
  await app.db.insert("user", user, uid);
  await app.db.insert("verifiedPhone", { id: digest(user.phone), userId: uid }, uid);
  for (const token of [first, second]) await app.db.insert("session", {
    id: digest(token), userId: uid, csrf: id(), expires: Date.now() + 86400000, passwordVersion: 0,
  }, uid);
  const otherId = digest("another-account@example.test"), otherToken = id();
  await app.db.insert("user", { id: otherId, email: "another-account@example.test", name: "حساب مستقل", role: "customer", password: "fixture" }, otherId);
  await app.db.insert("session", { id: digest(otherToken), userId: otherId, csrf: id(), expires: Date.now() + 86400000, passwordVersion: 0 }, otherId);
  const order = { id: id(), owner: uid, contracts: [{ agreement: "عقد قديم محفوظ", acceptedAt: "2026-01-02" }], files: [], payment: { amount: 2500 } };
  await app.db.insert("order", order, uid);
  assert.equal((await request("/api/session", undefined, `antlaqh_session=${first}`)).data.user.id, uid);
  const challenge = await request("/api/auth/recovery/request", { channel: "whatsapp", identifier: "0500000005" });
  assert.equal(challenge.status, 200);
  assert.match(challenge.data.challengeId, /^[a-f0-9]{36}$/);
  const checked = await request("/api/auth/recovery/verify", { challengeId: challenge.data.challengeId, code: "012345" });
  assert.equal(checked.status, 200);
  assert.match(checked.data.resetToken, /^[a-f0-9]{64}$/);
  assert.equal(checked.data.expiresIn, 1800);
  const password = "New-private-password-123";
  const reset = await request("/api/auth/recovery/reset", { token: checked.data.resetToken, password }, `antlaqh_session=${otherToken}`);
  assert.equal(reset.status, 200);
  assert.equal(reset.data.ok, true);
  assert.equal(reset.cookie, undefined, "reset response must not overwrite a newer session cookie");
  assert.equal((await request("/api/session", undefined, `antlaqh_session=${otherToken}`)).data.user.id, otherId);
  for (const token of [first, second]) assert.equal((await request("/api/session", undefined, `antlaqh_session=${token}`)).data.user, null);
  assert.deepEqual(await app.db.get("order", order.id), order);
  assert.equal((await app.db.get("user", uid)).authVersion, 1);
  assert.equal((await request("/api/auth/recovery/reset", { token: checked.data.resetToken, password })).status, 400);
  assert.equal((await request("/api/auth/recovery/verify", { challengeId: challenge.data.challengeId, code: "012345" })).status, 400);
  const login = await request("/api/auth/login", { email: mail, password });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, uid);
  assert.equal(login.data.user.name, user.name);
  assert.equal((await request("/api/session", undefined, login.cookie)).data.user.id, uid);
  assert.equal(providerCalls.find((call) => call.url.endsWith("/Verifications")).data.Channel, "whatsapp");
  for (let index = 0; index < 11; index++) assert.equal((await request("/api/auth/recovery/request", {
    channel: "whatsapp", identifier: `+966500000${String(10 + index).padStart(3, "0")}`,
  })).status, 200);
  assert.equal((await request("/api/auth/recovery/request", { channel: "whatsapp", identifier: "+966500000099" })).status, 429);
});
