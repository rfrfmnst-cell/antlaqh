import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssistant, validateConversation } from "../lib/assistant.js";
import { services } from "../lib/catalog.js";
const messages = [{ role: "user", content: "كيف أبدأ متجري؟" }];
const payload = {
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
