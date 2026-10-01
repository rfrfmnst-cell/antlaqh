import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const analyticsSource = readFileSync(new URL("../public/integrations.js", import.meta.url), "utf8");
const token = "a".repeat(64);
const challengeId = "b".repeat(36);
const genericMessage = "إذا كانت البيانات مرتبطة بحساب، فستصلك تعليمات الاستعادة عبر القناة المختارة.";
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

async function app({ hash = "#/forgot-password", recovery = {}, session = {}, request } = {}) {
  const listeners = new Map(), requests = [], replacements = [];
  const node = () => ({ innerHTML: "", textContent: "", hidden: true, focus() {}, querySelector() { return null; } });
  const nodes = new Map(["#main", "#header", "#footer", "#toast"].map(key => [key, node()]));
  let currentHash = hash;
  const location = {
    origin: "https://antlaqh.example.test",
    get hash() { return currentHash; },
    set hash(value) { currentHash = value.startsWith("#") ? value : "#" + value; },
  };
  const settings = { services: [], customerJourney: [], smsReady: false, assistantReady: false, recovery };
  const document = {
    title: "",
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: () => [],
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
  };
  const context = vm.createContext({
    document, location, URLSearchParams, Intl, Date,
    File: class {},
    FormData: class { constructor(form) { return Object.entries(form.fields); } },
    setTimeout: () => 1, clearTimeout() {},
    window: {
      scrollTo() {}, print() {}, addEventListener() {},
      history: { replaceState(_state, _title, url) { replacements.push(url); location.hash = url; } },
    },
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === "/api/config") return response(settings);
      if (path === "/api/session") return response(session);
      if (request) return request(path, options);
      throw new Error("Unexpected request: " + path);
    },
  });
  const runtime = await new vm.Script(`(async()=>{${source}\nreturn {state,render,api,forgotPassword,verifyRecovery,resetPassword,quoteForm};})()`).runInContext(context);
  return {
    ...runtime, nodes, location, requests, replacements,
    async submit(kind, fields = {}, { channel, disabled = false } = {}) {
      const button = { textContent: "إرسال", disabled };
      const error = { textContent: "", scrollIntoView() {} };
      const form = {
        dataset: { form: kind, channel }, fields, isConnected: true,
        querySelector(selector) { return selector === "button[type=submit]" ? button : selector === ".error" ? error : null; },
      };
      for (const handler of listeners.get("submit") || [])
        await handler({ preventDefault() {}, target: { closest() { return form; } } });
      return { button, error, form };
    },
  };
}

test("login links to recovery and unavailable channels remain visible without promising delivery", async () => {
  const ui = await app({ hash: "#/login" });
  assert.match(ui.nodes.get("#main").innerHTML, /href="#\/forgot-password"/);
  ui.location.hash = "#/forgot-password";
  await ui.render();
  const html = ui.nodes.get("#main").innerHTML;
  assert.match(html, /data-channel="email"/);
  assert.match(html, /data-channel="whatsapp"/);
  assert.equal((html.match(/غير مفعّلة حاليًا/g) || []).length, 2);
  assert.equal((html.match(/type="submit" disabled/g) || []).length, 2);
  const attempted = await ui.submit("recovery-request", { identifier: "user@example.test" }, { channel: "email", disabled: true });
  assert.match(attempted.error.textContent, /غير مفعّلة/);
  assert.equal(attempted.button.disabled, true);
  assert.equal(ui.requests.filter(r => r.path.includes("/recovery/")).length, 0);
});

test("email requests send only the selected channel and identifier and show the generic response", async () => {
  let payload;
  const ui = await app({ recovery: { emailReady: true }, request(path, options) {
    assert.equal(path, "/api/auth/recovery/request");
    payload = JSON.parse(options.body);
    return response({ challengeId, message: genericMessage });
  } });
  await ui.submit("recovery-request", { identifier: " user@example.test ", password: "not-sent" }, { channel: "email" });
  assert.deepEqual(payload, { channel: "email", identifier: "user@example.test" });
  assert.equal(ui.location.hash, "#/forgot-password");
  assert.match(ui.nodes.get("#main").innerHTML, /إذا كانت البيانات مرتبطة بحساب/);
  assert.doesNotMatch(ui.nodes.get("#main").innerHTML, new RegExp(challengeId));
  assert.equal(ui.state.resetToken, "");
});

test("WhatsApp verification retains leading zeroes and keeps the reset token out of links and HTML", async () => {
  const payloads = [];
  const ui = await app({ recovery: { whatsappReady: true }, request(path, options) {
    payloads.push({ path, body: JSON.parse(options.body) });
    return path.endsWith("/request")
      ? response({ challengeId, message: genericMessage })
      : response({ resetToken: token, expiresIn: 1800 });
  } });
  await ui.submit("recovery-request", { identifier: "0551234567" }, { channel: "whatsapp" });
  assert.equal(ui.location.hash, "#/verify");
  assert.match(ui.nodes.get("#main").innerHTML, /pattern="\[0-9\]\{4,10\}"/);
  await ui.submit("recovery-verify", { code: "004123", identifier: "not-sent" });
  assert.deepEqual(payloads[1].body, { challengeId, code: "004123" });
  assert.equal(ui.location.hash, "#/reset-password");
  assert.equal(ui.state.resetToken, token);
  assert.equal(ui.state.recoveryChallenge, null);
  assert.ok(ui.state.resetExpiresAt > Date.now());
  for (const key of ["#main", "#header", "#footer"])
    assert.doesNotMatch(ui.nodes.get(key).innerHTML, new RegExp(token));
});

test("email tokens are removed from the URL before any page links are rendered", async () => {
  const ui = await app({ hash: "#/reset-password?token=" + token });
  assert.deepEqual(ui.replacements, ["#/reset-password"]);
  assert.equal(ui.state.resetToken, token);
  assert.equal(ui.location.hash, "#/reset-password");
  assert.match(ui.nodes.get("#main").innerHTML, /name="password"[^>]*minlength="12" maxlength="128"/);
  for (const key of ["#main", "#header", "#footer"])
    assert.doesNotMatch(ui.nodes.get(key).innerHTML, new RegExp(token));
});

test("missing, malformed and expired recovery credentials require a new recovery request", async () => {
  const ui = await app({ hash: "#/reset-password?token=invalid" });
  assert.equal(ui.state.resetToken, "");
  assert.equal(ui.location.hash, "#/reset-password");
  assert.doesNotMatch(ui.nodes.get("#main").innerHTML, /data-form="recovery-reset"/);
  ui.state.resetToken = token;
  ui.state.resetExpiresAt = Date.now() - 1;
  await ui.render();
  assert.equal(ui.state.resetToken, "");
  assert.match(ui.nodes.get("#main").innerHTML, /طلب استعادة جديد/);
  ui.location.hash = "#/verify";
  await ui.render();
  assert.doesNotMatch(ui.nodes.get("#main").innerHTML, /data-form="recovery-verify"/);
});

test("password length and confirmation are checked before reset and success clears the current session", async () => {
  let payload;
  const ui = await app({ hash: "#/reset-password?token=" + token, session: { user: { id: "customer", name: "عميل", role: "customer" }, csrf: "session-token" }, request(path, options) {
    assert.equal(path, "/api/auth/recovery/reset");
    payload = JSON.parse(options.body);
    return response({ ok: true, message: "تم تغيير كلمة المرور." });
  } });
  const short = await ui.submit("recovery-reset", { password: "short", passwordConfirm: "short" });
  assert.match(short.error.textContent, /12 و128/);
  const mismatch = await ui.submit("recovery-reset", { password: "long-enough-password", passwordConfirm: "different-password" });
  assert.match(mismatch.error.textContent, /غير متطابقتين/);
  assert.equal(payload, undefined);
  await ui.submit("recovery-reset", { password: "long-enough-password", passwordConfirm: "long-enough-password" });
  assert.deepEqual(payload, { token, password: "long-enough-password" });
  assert.equal(ui.state.resetToken, "");
  assert.equal(ui.state.recoveryChallenge, null);
  assert.equal(ui.state.user, null);
  assert.equal(ui.state.csrf, "");
  assert.equal(ui.location.hash, "#/login");
  assert.match(ui.nodes.get("#main").innerHTML, /data-form="login"/);
});

test("a failed or unavailable recovery service does not claim that a message was sent", async () => {
  const ui = await app({ recovery: { emailReady: true }, request() { return response({ error: "إرسال البريد غير متاح حاليًا." }, 503); } });
  const form = await ui.submit("recovery-request", { identifier: "user@example.test" }, { channel: "email" });
  assert.match(form.error.textContent, /غير متاح/);
  assert.equal(form.button.disabled, false);
  assert.equal(ui.state.recoveryMessage, "");
  assert.equal(ui.state.recoveryChallenge, null);
});

test("a recovery request finishing after the visitor leaves does not restore challenge state", async () => {
  let finish;
  const ui = await app({ recovery: { whatsappReady: true }, request() { return new Promise(resolve => { finish = resolve; }); } });
  const pending = ui.submit("recovery-request", { identifier: "0551234567" }, { channel: "whatsapp" });
  ui.location.hash = "#/login";
  await ui.render();
  finish(response({ challengeId, message: genericMessage }));
  await pending;
  assert.equal(ui.state.recoveryChallenge, null);
  assert.equal(ui.location.hash, "#/login");
});

test("a recovery request cannot override navigation before hashchange renders it", async () => {
  let finish;
  const ui = await app({ recovery: { whatsappReady: true }, request() { return new Promise(resolve => { finish = resolve; }); } });
  const pending = ui.submit("recovery-request", { identifier: "0551234567" }, { channel: "whatsapp" });
  ui.location.hash = "#/services";
  finish(response({ challengeId, message: genericMessage }));
  await pending;
  assert.equal(ui.state.recoveryChallenge, null);
  assert.equal(ui.location.hash, "#/services");
});

test("a verified recovery code cannot override navigation before hashchange renders it", async () => {
  let finish;
  const ui = await app({ recovery: { whatsappReady: true }, request(path) {
    if (path.endsWith("/request")) return response({ challengeId, message: genericMessage });
    return new Promise(resolve => { finish = resolve; });
  } });
  await ui.submit("recovery-request", { identifier: "0551234567" }, { channel: "whatsapp" });
  const pending = ui.submit("recovery-verify", { code: "012345" });
  ui.location.hash = "#/services";
  finish(response({ resetToken: token, expiresIn: 1800 }));
  await pending;
  assert.equal(ui.state.resetToken, "");
  assert.equal(ui.location.hash, "#/services");
});

test("a newer recovery request wins when both channel forms submit before either response", async () => {
  const finishes = {};
  const ui = await app({ recovery: { whatsappReady: true, emailReady: true }, request(_path, options) {
    const { channel } = JSON.parse(options.body);
    return new Promise(resolve => { finishes[channel] = resolve; });
  } });
  const email = ui.submit("recovery-request", { identifier: "user@example.test" }, { channel: "email" });
  const whatsapp = ui.submit("recovery-request", { identifier: "0551234567" }, { channel: "whatsapp" });
  finishes.email(response({ challengeId: "c".repeat(36), message: "رد الطلب الأقدم" }));
  await email;
  assert.equal(ui.state.recoveryMessage, "");
  finishes.whatsapp(response({ challengeId, message: genericMessage }));
  await whatsapp;
  assert.equal(ui.state.recoveryChallenge, challengeId);
  assert.equal(ui.state.recoveryChannel, "whatsapp");
  assert.equal(ui.state.recoveryMessage, genericMessage);
  assert.equal(ui.location.hash, "#/verify");
});

test("a completed password reset invalidates the old session without changing a page visited meanwhile", async () => {
  let finish;
  const ui = await app({ hash: "#/reset-password?token=" + token,
    session: { user: { id: "customer", name: "عميل", role: "customer" }, csrf: "old-session" },
    request() { return new Promise(resolve => { finish = resolve; }); },
  });
  const pending = ui.submit("recovery-reset", { password: "long-enough-password", passwordConfirm: "long-enough-password" });
  ui.location.hash = "#/services";
  await ui.render();
  const page = ui.nodes.get("#main").innerHTML;
  finish(response({ ok: true, message: "تم تغيير كلمة المرور." }));
  await pending;
  assert.equal(ui.state.user, null);
  assert.equal(ui.state.csrf, "");
  assert.equal(ui.location.hash, "#/services");
  assert.equal(ui.nodes.get("#main").innerHTML, page);
});

test("a completed password reset keeps a newer recovery challenge and its page intact", async () => {
  let finishReset;
  const ui = await app({ hash: "#/reset-password?token=" + token, recovery: { whatsappReady: true },
    request(path) {
      if (path.endsWith("/reset")) return new Promise(resolve => { finishReset = resolve; });
      return response({ challengeId, message: genericMessage });
    },
  });
  const pending = ui.submit("recovery-reset", { password: "long-enough-password", passwordConfirm: "long-enough-password" });
  ui.location.hash = "#/forgot-password";
  await ui.render();
  await ui.submit("recovery-request", { identifier: "0551234567" }, { channel: "whatsapp" });
  const page = ui.nodes.get("#main").innerHTML;
  finishReset(response({ ok: true, message: "تم تغيير كلمة المرور." }));
  await pending;
  assert.equal(ui.state.recoveryChallenge, challengeId);
  assert.equal(ui.state.recoveryChannel, "whatsapp");
  assert.equal(ui.state.recoveryMessage, genericMessage);
  assert.equal(ui.location.hash, "#/verify");
  assert.equal(ui.nodes.get("#main").innerHTML, page);
});

test("a completed password reset cannot override navigation before hashchange renders it", async () => {
  let finish;
  const ui = await app({ hash: "#/reset-password?token=" + token,
    request() { return new Promise(resolve => { finish = resolve; }); },
  });
  const pending = ui.submit("recovery-reset", { password: "long-enough-password", passwordConfirm: "long-enough-password" });
  ui.location.hash = "#/services";
  finish(response({ ok: true, message: "تم تغيير كلمة المرور." }));
  await pending;
  assert.equal(ui.location.hash, "#/services");
  await ui.render();
  assert.equal(ui.state.resetToken, "");
  assert.doesNotMatch(ui.nodes.get("#main").innerHTML, /data-form="login"/);
});

test("a completed password reset cannot clear a newer authenticated session", async () => {
  let finish;
  const ui = await app({ hash: "#/reset-password?token=" + token,
    session: { user: { id: "old-account", name: "عميل", role: "customer" }, csrf: "old-session" },
    request() { return new Promise(resolve => { finish = resolve; }); },
  });
  const pending = ui.submit("recovery-reset", { password: "long-enough-password", passwordConfirm: "long-enough-password" });
  const newer = { id: "new-account", name: "عميل آخر", role: "customer" };
  ui.state.user = newer;
  ui.state.csrf = "new-session";
  ui.location.hash = "#/services";
  await ui.render();
  finish(response({ ok: true, message: "تم تغيير كلمة المرور." }));
  await pending;
  assert.equal(ui.state.user, newer);
  assert.equal(ui.state.csrf, "new-session");
  assert.equal(ui.location.hash, "#/services");
});

test("provider activity uses the server limit of 200 characters", async () => {
  const ui = await app();
  assert.match(ui.quoteForm({ id: "order", description: "scope" }, null), /name="providerActivity"[^>]*maxlength="200"/);
});

async function analytics(hash) {
  const location = { hash, origin: "https://antlaqh.example.test" }, scripts = [], events = [], listeners = new Map();
  const document = {
    querySelector() { return null; }, addEventListener() {},
    createElement() { return { setAttribute() {} }; },
    head: { append(element) { scripts.push(element); } }, body: { append() {} },
  };
  const window = { addEventListener(name, fn) { listeners.set(name, fn); } };
  const context = vm.createContext({ document, window, location, Date,
    localStorage: { getItem() { return "accepted"; } },
    fetch: async () => response({ integrations: { ga4MeasurementId: "G-TESTONLY" } }),
  });
  await new vm.Script(`(async()=>{${analyticsSource}})()`).runInContext(context);
  const pageViews = () => (window.dataLayer || []).filter(args => args[0] === "event" && args[1] === "page_view");
  return { scripts, location, window, pageViews, async navigate(hash) { location.hash = hash; await listeners.get("hashchange")(); } };
}

test("all recovery routes block analytics startup even with previous consent", async () => {
  for (const path of ["forgot-password", "verify", "reset-password?token=" + token]) {
    const ui = await analytics("#/" + path);
    assert.equal(ui.scripts.length, 0);
    assert.equal(ui.pageViews().length, 0);
  }
});

test("moving from a measured public page to recovery disables analytics and never sends a token", async () => {
  const ui = await analytics("#/services");
  assert.equal(ui.scripts.length, 1);
  assert.equal(ui.pageViews().length, 1);
  await ui.navigate("#/reset-password?token=" + token);
  assert.equal(ui.window["ga-disable-G-TESTONLY"], true);
  assert.equal(ui.pageViews().length, 1);
  assert.doesNotMatch(JSON.stringify(ui.window.dataLayer), new RegExp(token));
});
