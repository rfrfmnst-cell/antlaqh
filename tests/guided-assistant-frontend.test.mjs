import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/assistant.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const settings = { assistantReady: true, assistantMode: "guided", services: [{ id: "ready-website" }, { id: "store" }] };
const flush = () => new Promise(resolve => setImmediate(resolve));

function widget({ config = settings, configRequest, answer = { reply: "اختر خدمة تناسب مشروعك.", mode: "guided" } } = {}) {
  const calls = [], documentListeners = new Map();
  const document = { activeElement: null };
  class Element {
    constructor(tag = "div") {
      this.tag = tag;
      this.listeners = new Map();
      this.children = [];
      this.attributes = new Map();
      this.dataset = {};
      this.value = "";
      this.hidden = false;
      this.disabled = false;
      this.isConnected = true;
      const classes = new Set();
      this.classList = {
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name),
      };
    }
    addEventListener(type, listener) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    }
    async emit(type, values = {}) {
      const event = { target: this, preventDefault() {}, stopPropagation() {}, ...values };
      await Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
    }
    append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() { document.activeElement = this; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    hasAttribute(name) { return this.attributes.has(name); }
    closest(selector) {
      if (selector === "[data-ai-prompt]" && this.dataset.aiPrompt) return this;
      if (selector === "[data-assistant-open]" && this.hasAttribute("data-assistant-open")) return this;
      return null;
    }
    showModal() { this.open = true; }
    close() { this.open = false; }
    requestSubmit() { return this.emit("submit"); }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html || ""; }
  }
  const host = new Element();
  const elements = new Map([
    "dialog", ".ai-launcher", ".ai-conversation", "textarea", ".ai-send", ".ai-error",
    ".ai-retry", ".ai-status", ".ai-close", ".ai-form", ".ai-clear", ".ai-privacy",
  ].map(selector => [selector, new Element()]));
  const suggestions = Array.from({ length: 4 }, (_, i) => {
    const button = new Element("button");
    button.dataset.aiPrompt = ["أريد موقعًا جاهزًا", "أريد متجرًا", "ما عرض الإطلاق؟", "كيف أبدأ الطلب؟"][i];
    return button;
  });
  const conversation = elements.get(".ai-conversation");
  conversation.innerHTML = "opening message and suggestions";
  host.querySelector = selector => elements.get(selector);
  host.querySelectorAll = selector => selector === "[data-ai-prompt]" ? suggestions : [];
  const errorText = new Element();
  elements.get(".ai-error").querySelector = () => errorText;
  let created = false;
  document.body = new Element();
  document.createElement = tag => {
    if (!created) { created = true; return host; }
    return new Element(tag);
  };
  document.addEventListener = (type, listener) => documentListeners.set(type, [...(documentListeners.get(type) || []), listener]);
  const draft = new Element("textarea");
  document.getElementById = id => id === "home-ai-draft" ? draft : null;
  const forbiddenStorage = new Proxy({}, { get() { throw Error("Conversation must not access browser storage"); } });
  runInNewContext(source, {
    document, AbortController, TypeError,
    localStorage: forbiddenStorage, sessionStorage: forbiddenStorage,
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (path, options) => {
      calls.push({ path, options });
      return path === "/api/config" ? configRequest ? configRequest(options) : response(config) : response(answer);
    },
  });
  return {
    host, document, calls, elements, suggestions, conversation, errorText,
    get: selector => elements.get(selector),
    click: selector => elements.get(selector).emit("click"),
    async submit(content) {
      elements.get("textarea").value = content;
      await elements.get(".ai-form").emit("submit");
      await flush();
    },
    async suggest(index = 0) {
      await conversation.emit("click", { target: suggestions[index] });
      await flush();
    },
    async homeQuestion(content, typed = false) {
      const trigger = new Element("button");
      trigger.setAttribute("data-assistant-open", "");
      if (typed) {
        trigger.setAttribute("data-assistant-draft", "");
        draft.value = content;
      } else trigger.dataset.assistantPrompt = content;
      await Promise.all((documentListeners.get("click") || []).map(listener => listener({ target: trigger, preventDefault() {} })));
      await flush();
    },
    sent: () => calls.filter(call => call.path === "/api/assistant").map(call => JSON.parse(call.options.body)),
  };
}

test("guided configuration enables free guidance and unavailable configuration blocks sending", async () => {
  const ui = widget();
  await ui.click(".ai-launcher");
  assert.equal(ui.get("textarea").disabled, false);
  assert.equal(ui.get(".ai-send").disabled, false);
  assert.match(ui.get(".ai-status").textContent, /الإرشاد المجاني متاح الآن/);
  assert.match(ui.host.innerHTML, /مساعد انطلاقة/);
  assert.doesNotMatch(ui.host.innerHTML, /OpenAI|ChatGPT|بانتظار التفعيل/);
  assert.match(ui.get(".ai-privacy").textContent, /لا يصل المساعد إلى حسابك/);

  const unavailable = widget({ config: { ...settings, assistantReady: false } });
  await unavailable.click(".ai-launcher");
  await unavailable.suggest();
  await unavailable.submit("أريد موقعًا");
  assert.equal(unavailable.get("textarea").disabled, true);
  assert.equal(unavailable.sent().length, 0);
  assert.match(unavailable.get(".ai-status").textContent, /غير متاح حاليًا/);
});

test("suggestions and homepage questions submit an actual user question without extra account data", async () => {
  const ui = widget();
  await ui.click(".ai-launcher");
  await ui.suggest();
  assert.deepEqual(ui.sent()[0], { messages: [{ role: "user", content: "أريد موقعًا جاهزًا" }] });
  await ui.click(".ai-clear");
  await ui.suggest(2);
  assert.equal(ui.sent().length, 2);
  assert.deepEqual(ui.sent()[1].messages, [{ role: "user", content: "ما عرض الإطلاق؟" }]);

  const homepage = widget();
  await homepage.homeQuestion("كيف يبدأ العقد؟");
  assert.deepEqual(homepage.sent()[0], { messages: [{ role: "user", content: "كيف يبدأ العقد؟" }] });
  await homepage.click(".ai-clear");
  await homepage.homeQuestion("  أحتاج موقعًا لمقهى  ", true);
  assert.deepEqual(homepage.sent()[1].messages, [{ role: "user", content: "أحتاج موقعًا لمقهى" }]);
});

test("an older delayed opening cannot send its question after a newer question completes", async () => {
  const checks = [];
  const ui = widget({ configRequest: () => new Promise(resolve => checks.push(resolve)) });
  const older = ui.homeQuestion("أريد موقعًا جاهزًا");
  const newer = ui.homeQuestion("أريد متجرًا");
  assert.equal(checks.length, 2);
  checks[1](response(settings));
  await newer;
  checks[0](response(settings));
  await older;
  assert.deepEqual(ui.sent(), [{ messages: [{ role: "user", content: "أريد متجرًا" }] }]);
  assert.equal(ui.get("textarea").value, "");
});

test("clearing during a delayed opening prevents its question from repopulating the conversation", async () => {
  let finishCheck;
  const ui = widget({ configRequest: () => new Promise(resolve => { finishCheck = resolve; }) });
  const opening = ui.homeQuestion("أحتاج موقعًا لمقهى", true);
  await ui.click(".ai-clear");
  finishCheck(response(settings));
  await opening;
  assert.equal(ui.sent().length, 0);
  assert.equal(ui.conversation.children.length, 0);
  assert.equal(ui.get("textarea").value, "");
  assert.equal(ui.get("textarea").disabled, false);
  await ui.suggest();
  assert.deepEqual(ui.sent()[0], { messages: [{ role: "user", content: "أريد موقعًا جاهزًا" }] });
});

test("closing and reopening during a delayed opening does not revive its old question", async () => {
  const checks = [];
  const ui = widget({ configRequest: () => new Promise(resolve => checks.push(resolve)) });
  const older = ui.homeQuestion("كيف يبدأ العقد؟");
  await ui.click(".ai-close");
  const fresh = ui.click(".ai-launcher");
  checks[1](response(settings));
  await fresh;
  checks[0](response(settings));
  await older;
  assert.equal(ui.get("dialog").open, true);
  assert.equal(ui.get("textarea").disabled, false);
  assert.equal(ui.sent().length, 0);
  assert.equal(ui.get("textarea").value, "");
});

test("reply text stays plain text and response actions accept only existing public destinations", async () => {
  const injected = '<img src=x onerror="alert(1)">';
  const ui = widget({ answer: { reply: injected, mode: "guided", links: [
    { label: injected, href: "#/service/ready-website" },
    { label: "ابدأ طلبًا", href: "#/start?service=ready-website" },
    { label: "نموذج المقهى", href: "/demos/restaurant/" },
    { label: "طلب خاص", href: "#/order/123" },
    { label: "موقع خارجي", href: "https://external.example/" },
    { label: "خدمة غير موجودة", href: "#/service/unknown-service" },
  ] } });
  await ui.click(".ai-launcher");
  await ui.submit("أريد موقعًا جاهزًا");
  const reply = ui.conversation.children.find(child => child.className === "ai-message ai-assistant");
  assert.equal(reply.children[1].textContent, injected);
  assert.equal(reply.children[1].children.length, 0);
  const actions = reply.children.find(child => child.className === "ai-message-links");
  assert.deepEqual(actions.children.map(anchor => anchor.attributes.get("href")), [
    "#/service/ready-website", "#/start?service=ready-website", "/demos/restaurant/",
  ]);
  assert.equal(actions.children[0].textContent, injected);
  assert.equal(actions.children[2].attributes.get("target"), "_blank");
  assert.equal(actions.children[2].attributes.get("rel"), "noopener noreferrer");
  await actions.children[0].emit("click");
  assert.equal(ui.get("dialog").open, false);
});

test("closing preserves session context, restores focus, and clearing removes that context", async () => {
  const ui = widget();
  const launcher = ui.get(".ai-launcher");
  launcher.focus();
  await ui.click(".ai-launcher");
  await ui.submit("أريد موقعًا");
  await ui.click(".ai-close");
  assert.equal(ui.document.activeElement, launcher);
  assert.equal(launcher.attributes.get("aria-expanded"), "false");
  await ui.click(".ai-launcher");
  await ui.submit("ما السعر؟");
  assert.deepEqual(ui.sent()[1].messages.map(message => message.role), ["user", "assistant", "user"]);
  assert.equal(ui.sent()[1].messages[0].content, "أريد موقعًا");
  await ui.click(".ai-clear");
  await ui.submit("كيف أبدأ الطلب؟");
  assert.deepEqual(ui.sent()[2].messages, [{ role: "user", content: "كيف أبدأ الطلب؟" }]);
  assert.equal(ui.get("textarea").disabled, false);
});

test("homepage availability and privacy describe the guided service truthfully", () => {
  function definition(name) {
    const start = appSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    const end = appSource.indexOf("\nfunction ", start + 1);
    return appSource.slice(start, end);
  }
  const state = { config: settings };
  const runtime = runInNewContext(`${definition("homepageAssistant")}\n${definition("assistantPrivacy")}\n({homepageAssistant,assistantPrivacy})`, { state, icon: () => "" });
  const home = runtime.homepageAssistant();
  assert.match(home, /المساعد الإرشادي المجاني متاح الآن/);
  assert.match(home, /data-assistant-prompt=/);
  assert.doesNotMatch(home, /بانتظار التفعيل|OpenAI|ChatGPT/);
  assert.match(runtime.assistantPrivacy(), /لا يستخدم خدمة محادثة خارجية/);
  state.config = { ...settings, assistantReady: false };
  assert.match(runtime.homepageAssistant(), /المساعد غير متاح حاليًا/);
  state.config = { ...settings, assistantMode: "openai" };
  assert.match(runtime.assistantPrivacy(), /خدمة مساعدة خارجية/);
  assert.doesNotMatch(runtime.assistantPrivacy(), /لا يستخدم خدمة محادثة خارجية/);
});
