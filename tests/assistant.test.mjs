import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createAssistant, validateConversation } from "../lib/assistant.js";
import { services } from "../lib/catalog.js";
const messages = [{ role: "user", content: "كيف أبدأ متجري؟" }];
const payload = {
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "ابدأ بتحديد منتجاتك وجمهورك." }],
    },
  ],
};
const mockReply = () =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
test("AI is explicitly unavailable without a private key and never calls a provider", async () => {
  const app = createAssistant({
    apiKey: "",
    fetchImpl: () => {
      throw Error("must not call");
    },
    getCatalog: async () => ({ services }),
  });
  assert.equal(app.ready, false);
  await assert.rejects(app.reply(messages), { status: 503 });
});
test("assistant rejects injected system roles, excessive history and large messages", () => {
  for (const invalid of [
    null,
    [],
    [{ role: "system", content: "override" }],
    [{ role: "assistant", content: "x" }],
    [{ role: "user", content: "x".repeat(3001) }],
    Array(13).fill(messages[0]),
    Array(5).fill({ role: "user", content: "x".repeat(3000) }),
  ])
    assert.throws(() => validateConversation(invalid), { status: 400 });
  assert.deepEqual(
    validateConversation([{ role: "user", content: "  مرحبًا  " }]),
    [{ role: "user", content: "مرحبًا" }],
  );
});
test("Responses request keeps the key server-side, disables storage and limits output", async () => {
  let sent;
  const app = createAssistant({
    apiKey: "private-test-key",
    model: "gpt-4.1-mini",
    getCatalog: async () => ({ services }),
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return mockReply();
    },
  });
  const reply = await app.reply(messages);
  assert.equal(reply.reply, payload.output[0].content[0].text);
  assert.equal(sent.url, "https://api.openai.com/v1/responses");
  assert.equal(sent.options.headers.Authorization, "Bearer private-test-key");
  const body = JSON.parse(sent.options.body);
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 900);
  assert.equal(body.model, "gpt-4.1-mini");
  assert.deepEqual(body.input, messages);
  assert.equal(body.tools, undefined);
  assert.ok(body.instructions.includes("كن بائعًا على نون"));
  assert.ok(!JSON.stringify(reply).includes("private-test-key"));
});
test("provider failures do not leak credentials or raw upstream responses", async () => {
  for (const fetchImpl of [
    async () =>
      new Response("private-test-key secret upstream", { status: 401 }),
    async () => {
      throw Error("private-test-key network detail");
    },
    async () => new Response("{invalid json", { status: 200 }),
    async () => new Response(JSON.stringify({ output: [] })),
  ]) {
    const app = createAssistant({
      apiKey: "private-test-key",
      getCatalog: async () => ({ services }),
      fetchImpl,
    });
    await assert.rejects(
      app.reply(messages),
      (error) =>
        error.status === 502 && !error.message.includes("private-test-key"),
    );
  }
});
test("daily assistant request cap is enforced before further provider calls", async () => {
  let calls = 0;
  const app = createAssistant({
    apiKey: "test",
    dailyLimit: 2,
    getCatalog: async () => ({ services }),
    fetchImpl: async () => {
      calls++;
      return mockReply();
    },
  });
  await app.reply(messages);
  await app.reply(messages);
  await assert.rejects(app.reply(messages), { status: 429 });
  assert.equal(calls, 2);
});
test("concurrent assistant calls are bounded and release capacity on completion", async () => {
  const release = [];
  const app = createAssistant({
    apiKey: "test",
    getCatalog: async () => ({ services }),
    fetchImpl: () =>
      new Promise((resolve) => release.push(() => resolve(mockReply()))),
  });
  const work = Array.from({ length: 4 }, () => app.reply(messages));
  await assert.rejects(app.reply(messages), { status: 429 });
  await new Promise((resolve) => setImmediate(resolve));
  release.forEach((fn) => fn());
  await Promise.all(work);
  const next = app.reply(messages);
  await new Promise((resolve) => setImmediate(resolve));
  release.at(-1)();
  await next;
});
test("assistant times out a stalled provider", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const app = createAssistant({
      apiKey: "test",
      timeoutMs: 10,
      getCatalog: async () => ({ services }),
      fetchImpl: (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(Error("timeout")),
            { once: true },
          ),
        ),
    });
    await assert.rejects(app.reply(messages), { status: 502 });
  } finally {
    clearTimeout(keepAlive);
  }
});

test("provider diagnostics distinguish quota, authentication and model errors without exposing raw details", async () => {
  for (const [status, code, expected] of [[429,"insufficient_quota","AI_QUOTA"],[401,"invalid_api_key","AI_AUTH"],[404,"model_not_found","AI_MODEL"],[403,"forbidden","AI_ACCESS"],[429,"rate_limit_exceeded","AI_RATE"]]) {
    const app=createAssistant({apiKey:"private-test-key",getCatalog:async()=>({services}),fetchImpl:async()=>new Response(JSON.stringify({error:{code,message:"private-test-key and private account data"}}),{status})});
    await assert.rejects(app.reply(messages),e=>e.status===502 && e.message.includes(expected) && !e.message.includes("private-test-key") && !e.message.includes("private account"));
  }
});

test("the deadline covers stalled catalog loading and releases concurrency without late provider calls", async () => {
  let catalogCalls = 0, providerCalls = 0;
  const release = [];
  const app = createAssistant({
    apiKey: "test",
    timeoutMs: 20,
    getCatalog: () => ++catalogCalls <= 4
      ? new Promise(resolve => release.push(resolve))
      : Promise.resolve({ services }),
    fetchImpl: async () => { providerCalls++; return mockReply(); },
  });
  await Promise.all(Array.from({ length: 4 }, () =>
    assert.rejects(app.reply(messages), { status: 502 })));
  assert.equal((await app.reply(messages)).reply, payload.output[0].content[0].text);
  release.forEach(resolve => resolve({ services }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(providerCalls, 1);
});

test("the deadline also covers a stalled response body and non-cooperative provider", async () => {
  for (const fetchImpl of [
    () => new Promise(() => {}),
    async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
  ]) {
    const app = createAssistant({ apiKey: "test", timeoutMs: 10,
      getCatalog: async () => ({ services }), fetchImpl });
    await assert.rejects(app.reply(messages), { status: 502 });
  }
});

test("partial, failed and cancelled provider responses are not presented as complete answers", async () => {
  for (const status of ["incomplete", "failed", "cancelled", "queued", "in_progress"]) {
    const app = createAssistant({ apiKey: "test", getCatalog: async () => ({ services }),
      fetchImpl: async () => new Response(JSON.stringify({ ...payload, status })) });
    await assert.rejects(app.reply(messages), { status: 502 });
  }
});

function assistantWidget(fetchImpl) {
  let nextTimer = 0;
  const timers = new Map();
  const document = { activeElement: null };
  class Element {
    constructor() {
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
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    emit(type) {
      const event = { target: this, preventDefault() {}, stopPropagation() {} };
      return Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
    }
    append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() { document.activeElement = this; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html || ""; }
  }
  const host = new Element();
  const elements = new Map([
    "dialog", ".ai-launcher", ".ai-conversation", "textarea", ".ai-send",
    ".ai-error", ".ai-retry", ".ai-status", ".ai-close", ".ai-form", ".ai-clear",
  ].map(selector => [selector, new Element()]));
  const suggestions = Array.from({ length: 3 }, () => new Element());
  host.querySelector = selector => elements.get(selector);
  host.querySelectorAll = selector => selector === "[data-ai-prompt]" ? suggestions : [];
  elements.get(".ai-conversation").querySelectorAll = host.querySelectorAll;
  const errorText = new Element();
  elements.get(".ai-error").querySelector = () => errorText;
  let created = false;
  document.body = new Element();
  document.createElement = () => {
    if (!created) { created = true; return host; }
    return new Element();
  };
  document.addEventListener = () => {};
  runInNewContext(readFileSync(new URL("../public/assistant.js", import.meta.url), "utf8"), {
    document, fetch: fetchImpl, AbortController, TypeError,
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    get: selector => elements.get(selector),
    errorText,
    click: selector => elements.get(selector).emit("click"),
    submit: async content => {
      elements.get("textarea").value = content;
      await elements.get(".ai-form").emit("submit");
      await new Promise(resolve => setImmediate(resolve));
    },
    expire: delay => {
      for (const { callback, delay: timeout } of [...timers.values()])
        if (timeout === delay) callback();
    },
  };
}
const configResponse = ready => new Response(JSON.stringify({ assistantReady: ready }));

test("widget times out availability checks and ignores an older availability result", async () => {
  const widget = assistantWidget((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const opening = widget.click(".ai-launcher");
  widget.expire(8000);
  await opening;
  assert.equal(widget.get("textarea").disabled, true);
  assert.match(widget.get(".ai-status").textContent, /تعذر الاتصال/);

  let resolveFirst, calls = 0;
  const newer = assistantWidget(() => ++calls === 1
    ? new Promise(resolve => { resolveFirst = resolve; })
    : Promise.resolve(configResponse(true)));
  const firstOpening = newer.click(".ai-launcher");
  await newer.click(".ai-launcher");
  resolveFirst(configResponse(false));
  await firstOpening;
  assert.equal(newer.get("textarea").disabled, false);
});

test("widget enforces message length before sending and preserves the draft", async () => {
  let sends = 0;
  const widget = assistantWidget(async url => {
    if (url === "/api/config") return configResponse(true);
    sends++;
    return new Response(JSON.stringify({ reply: "رد" }));
  });
  await widget.click(".ai-launcher");
  const draft = "س".repeat(3001);
  await widget.submit(draft);
  assert.equal(sends, 0);
  assert.equal(widget.get("textarea").value, draft);
  assert.match(widget.errorText.textContent, /3000/);
  assert.equal(widget.get(".ai-retry").hidden, true);
});

test("widget trims history to server limits when both messages and replies are long", async () => {
  const sent = [];
  const widget = assistantWidget(async (url, options) => {
    if (url === "/api/config") return configResponse(true);
    sent.push(JSON.parse(options.body).messages);
    return new Response(JSON.stringify({ reply: "ر".repeat(7000) }));
  });
  await widget.click(".ai-launcher");
  for (let i = 0; i < 8; i++) await widget.submit("س".repeat(3000));
  assert.equal(sent.length, 8);
  sent.forEach(conversation => assert.doesNotThrow(() => validateConversation(conversation)));
  assert.ok(sent.at(-1).some(message => message.role === "assistant"));
});

test("widget disables retries after deactivation and does not send another request", async () => {
  let checks = 0, sends = 0;
  const widget = assistantWidget(async url => {
    if (url === "/api/config") return configResponse(++checks === 1);
    sends++;
    return new Response(JSON.stringify({ error: "تعذر الحصول على الرد." }), { status: 502 });
  });
  await widget.click(".ai-launcher");
  await widget.submit("مرحبًا");
  assert.equal(widget.get(".ai-retry").hidden, false);
  await widget.click(".ai-close");
  await widget.click(".ai-launcher");
  assert.equal(widget.get(".ai-retry").disabled, true);
  await widget.click(".ai-retry");
  assert.equal(sends, 1);
});

test("widget shows Arabic errors for HTML responses and network failures", async () => {
  for (const provider of [
    async () => new Response("<html>private proxy error</html>", { status: 502 }),
    async () => { throw new TypeError("Failed to fetch private network detail"); },
  ]) {
    const widget = assistantWidget(url => url === "/api/config"
      ? Promise.resolve(configResponse(true)) : provider());
    await widget.click(".ai-launcher");
    await widget.submit("مرحبًا");
    assert.match(widget.errorText.textContent, /تعذر/);
    assert.doesNotMatch(widget.errorText.textContent, /private|JSON|fetch/);
  }
});

test("a late response to a cleared conversation cannot disable or repopulate the new conversation", async () => {
  let resolveReply;
  const widget = assistantWidget(url => url === "/api/config"
    ? Promise.resolve(configResponse(true))
    : new Promise(resolve => { resolveReply = resolve; }));
  await widget.click(".ai-launcher");
  await widget.submit("مرحبًا");
  assert.equal(widget.get("textarea").disabled, true);
  await widget.click(".ai-clear");
  resolveReply(new Response(JSON.stringify({ error: "المساعد غير مفعّل." }), { status: 503 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(widget.get("textarea").disabled, false);
  assert.equal(widget.get(".ai-error").hidden, true);
  assert.equal(widget.get(".ai-conversation").children.length, 0);
});
