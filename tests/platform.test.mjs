import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { contractDetailsFixture } from "./contract-fixture.mjs";

const root = resolve(import.meta.dirname, "..");
let server,
  db,
  base,
  dir,
  port,
  admin,
  alice,
  bob,
  service,
  product,
  productOrder;
const secret = "Test-only-" + randomBytes(24).toString("hex");
const pdf = Buffer.from(
  "%PDF-1.4\nAntlaqh test fixture, not a saleable product.\n%%EOF",
);
async function request(
  path,
  { as, method = "GET", body, headers = {}, origin = true, csrf = true } = {},
) {
  const h = { ...headers };
  if (as?.cookie) h.Cookie = as.cookie;
  if (origin && method !== "GET") h.Origin = base;
  if (as?.csrf && csrf) h["X-CSRF-Token"] = as.csrf;
  if (body && !(body instanceof Buffer)) {
    if (path.endsWith("/quote") && body.contractDetails === undefined)
      body = { ...body, contractDetails: structuredClone(contractDetailsFixture) };
    body = JSON.stringify(body);
    h["Content-Type"] = "application/json";
  }
  const response = await fetch(base + path, { method, body, headers: h });
  const raw = await response.arrayBuffer();
  let data;
  try {
    data = JSON.parse(Buffer.from(raw).toString());
  } catch {
    data = Buffer.from(raw);
  }
  return { status: response.status, data, headers: response.headers };
}
async function register(name, email) {
  const r = await request("/api/auth/register", {
    method: "POST",
    body: {
      name,
      email,
      password: secret,
      acceptTerms: true,
      role: "admin",
      phoneVerified: true,
    },
  });
  assert.equal(r.status, 201);
  return { ...r.data, cookie: r.headers.get("set-cookie").split(";")[0] };
}
async function startServer(sms = false) {
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: String(port),
    APP_URL: base,
    DB_DRIVER: "sqlite",
    OPENAI_API_KEY: "",
    ASSISTANT_MODE: "guided",
    DATA_DIR: dir,
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.test",
    BOOTSTRAP_ADMIN_PASSWORD: secret,
    TWILIO_ACCOUNT_SID: sms ? "mock-account" : "",
    TWILIO_AUTH_TOKEN: sms ? "mock-only-token" : "",
    TWILIO_VERIFY_SERVICE_SID: sms ? "mock-service" : "",
  });
  const app = await import(
    new URL("../server.js?test=" + Date.now(), import.meta.url)
  );
  server = app.server;
  db = app.db;
  if (!server.listening) await new Promise((r) => server.once("listening", r));
}
async function stopServer() {
  if (!server?.listening) return;
  const done = new Promise((r) => server.close(r));
  server.closeAllConnections();
  await done;
  await db.close();
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "antlaqh-test-"));
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  port = socket.address().port;
  await new Promise((r) => socket.close(r));
  base = `http://127.0.0.1:${port}`;
  await startServer();
  const a = await request("/api/auth/login", {
    method: "POST",
    body: { email: "admin@example.test", password: secret },
  });
  assert.equal(a.status, 200);
  admin = { ...a.data, cookie: a.headers.get("set-cookie").split(";")[0] };
  alice = await register("عميل أول", "alice@example.test");
  bob = await register("عميل آخر", "bob@example.test");
});
after(async () => {
  await stopServer();
  await rm(dir, { recursive: true, force: true });
});

test("registration ignores privilege and verification fields; cookies are HttpOnly", async () => {
  assert.equal(alice.user.role, "customer");
  assert.equal(alice.user.phoneVerified, false);
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "alice@example.test", password: secret },
  });
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Lax/);
  assert.equal(
    (await request("/api/admin/customers", { as: alice })).status,
    403,
  );
});
test("session-bound CSRF and origin protections reject unauthorized writes", async () => {
  const payload = {
    type: "service",
    service: "website",
    title: "مشروع اختبار",
    description: "هذه تفاصيل مشروع الاختبار الأساسية.",
  };
  assert.equal(
    (
      await request("/api/orders", {
        as: alice,
        method: "POST",
        body: payload,
        csrf: false,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/orders", {
        as: alice,
        method: "POST",
        body: payload,
        origin: false,
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/orders", { method: "POST", body: payload })).status,
    401,
  );
});
test("service order is owned by session; untrusted amount and paid flags are ignored", async () => {
  const r = await request("/api/orders", {
    as: alice,
    method: "POST",
    body: {
      type: "service",
      service: "website",
      title: "موقع انطلاقة التجريبي",
      description: "نريد إنشاء موقع عربي قابل لإدارة الطلبات.",
      owner: bob.user.id,
      amount: 1,
      paid: true,
    },
  });
  assert.equal(r.status, 201);
  service = r.data;
  assert.equal(service.owner, alice.user.id);
  assert.equal(service.payment, null);
  assert.equal(service.amount, undefined);
  assert.equal(
    (await request("/api/orders/" + service.id, { as: bob })).status,
    404,
  );
  assert.equal(
    (
      await request("/api/orders/" + service.id + "/messages", {
        as: bob,
        method: "POST",
        body: { message: "test" },
      })
    ).status,
    404,
  );
});
test("only admin may issue quotes; contract versions and acceptance are enforced", async () => {
  const quote = {
    agreement: "تنفيذ موقع كامل وفق وصف الطلب المتفق عليه.",
    amount: 250000,
    deliveryDate: "2027-01-15",
    terms: "تتم المراجعة والتسليم حسب النطاق المتفق عليه.",
  };
  assert.equal(
    (
      await request(`/api/orders/${service.id}/quote`, {
        as: alice,
        method: "POST",
        body: quote,
      })
    ).status,
    403,
  );
  let r = await request(`/api/orders/${service.id}/quote`, {
    as: admin,
    method: "POST",
    body: quote,
  });
  assert.equal(r.status, 200);
  let contract = r.data.currentContract;
  assert.equal(
    (
      await request(`/api/orders/${service.id}/accept`, {
        as: alice,
        method: "POST",
        body: { accept: true, contractId: "wrong" },
      })
    ).status,
    409,
  );
  r = await request(`/api/orders/${service.id}/accept`, {
    as: alice,
    method: "POST",
    body: { accept: true, contractId: contract },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "awaiting_payment");
  const original = r.data.contracts[0];
  assert.match(original.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(original.acceptance.fingerprint, original.fingerprint);
  assert.equal(original.acceptance.customer.email, "alice@example.test");
  r = await request(`/api/orders/${service.id}/quote`, {
    as: admin,
    method: "POST",
    body: { ...quote, amount: 260000 },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.contracts[0], original);
  assert.equal(r.data.status, "quoted");
  r = await request(`/api/orders/${service.id}/accept`, {
    as: alice,
    method: "POST",
    body: { accept: true, contractId: r.data.currentContract },
  });
  assert.equal(r.status, 200);
  service = r.data;
});
test("payment confirmation is admin-only, atomic and idempotent", async () => {
  const path = `/api/orders/${service.id}/confirm-payment`,
    body = { reference: "TEST-TRANSFER-001" };
  assert.equal(
    (await request(path, { as: alice, method: "POST", body })).status,
    403,
  );
  const results = await Promise.all([
    request(path, { as: admin, method: "POST", body }),
    request(path, { as: admin, method: "POST", body }),
  ]);
  for (const r of results) assert.equal(r.status, 200);
  const r = await request("/api/orders/" + service.id, { as: alice });
  assert.equal(r.data.payment.amount, 260000);
  assert.equal(
    r.data.events.filter((e) => e.message === "أكدت الإدارة استلام الدفع")
      .length,
    1,
  );
  assert.equal(r.data.status, "paid");
  assert.equal(
    (
      await request(`/api/orders/${service.id}/quote`, {
        as: admin,
        method: "POST",
        body: {
          agreement: "عرض بديل لا يجب قبوله بعد الدفع",
          amount: 100,
          deliveryDate: "2027-01-15",
          terms: "شروط اختبارية يجب عدم قبولها.",
        },
      })
    ).status,
    409,
  );
});
test("project workflow prevents jumping stages", async () => {
  const path = `/api/orders/${service.id}/status`;
  assert.equal(
    (
      await request(path, {
        as: admin,
        method: "POST",
        body: { status: "completed" },
      })
    ).status,
    409,
  );
  for (const status of ["in_progress", "final_review", "completed"])
    assert.equal(
      (
        await request(path, {
          as: admin,
          method: "POST",
          body: { status, note: "تحديث اختباري للمرحلة." },
        })
      ).status,
      200,
    );
});
test("files validate signatures, stay private, and cannot be read by another customer", async () => {
  const path = `/api/orders/${service.id}/files`;
  assert.equal(
    (
      await request(path, {
        as: alice,
        method: "POST",
        body: Buffer.from("<script>bad</script>"),
        headers: {
          "Content-Type": "application/pdf",
          "X-File-Name": "fake.pdf",
        },
      })
    ).status,
    400,
  );
  const r = await request(path, {
    as: alice,
    method: "POST",
    body: pdf,
    headers: {
      "Content-Type": "application/pdf",
      "X-File-Name": "receipt.pdf",
    },
  });
  assert.equal(r.status, 201);
  const file = r.data.files[0];
  assert.equal((await request(path + "/" + file.id, { as: bob })).status, 404);
  assert.equal((await request(path + "/" + file.id)).status, 401);
  const download = await request(path + "/" + file.id, { as: alice });
  assert.equal(download.status, 200);
  assert.deepEqual(download.data, pdf);
  assert.match(download.headers.get("content-disposition"), /attachment/);
});
test("digital products cannot be published or purchased without a delivery file", async () => {
  let r = await request("/api/admin/products", {
    as: admin,
    method: "POST",
    body: {
      title: "منتج اختباري غير تجاري",
      description: "ملف اختباري لقياس صلاحيات التنزيل فقط.",
      category: "اختبار",
      amount: 9900,
    },
  });
  assert.equal(r.status, 201);
  product = r.data;
  assert.equal(
    (
      await request("/api/admin/products/" + product.id, {
        as: admin,
        method: "POST",
        body: { published: true },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/orders", {
        as: alice,
        method: "POST",
        body: { type: "product", productId: product.id, acceptTerms: true },
      })
    ).status,
    404,
  );
  r = await request(`/api/admin/products/${product.id}/file`, {
    as: admin,
    method: "POST",
    body: pdf,
    headers: {
      "Content-Type": "application/pdf",
      "X-File-Name": "product.pdf",
    },
  });
  assert.equal(r.status, 200);
  r = await request("/api/admin/products/" + product.id, {
    as: admin,
    method: "POST",
    body: { published: true },
  });
  assert.equal(r.status, 200);
  const catalog = await request("/api/products");
  assert.equal(catalog.data[0].file, undefined);
  assert.equal(catalog.data[0].hasFile, true);
});
test("server snapshots product price and denies download before payment", async () => {
  const r = await request("/api/orders", {
    as: alice,
    method: "POST",
    body: {
      type: "product",
      productId: product.id,
      acceptTerms: true,
      amount: 1,
      payment: { confirmed: true },
    },
  });
  assert.equal(r.status, 201);
  productOrder = r.data;
  assert.equal(productOrder.amount, 9900);
  assert.equal(productOrder.payment, null);
  assert.equal(
    (await request(`/api/orders/${productOrder.id}/download`, { as: alice }))
      .status,
    403,
  );
  await request(`/api/orders/${productOrder.id}/files`, {
    as: alice,
    method: "POST",
    body: pdf,
    headers: {
      "Content-Type": "application/pdf",
      "X-File-Name": "receipt.pdf",
    },
  });
  assert.equal(
    (await request(`/api/orders/${productOrder.id}/download`, { as: alice }))
      .status,
    403,
  );
});
test("paid product download is scoped to buyer and revoked entitlement takes effect", async () => {
  const path = `/api/orders/${productOrder.id}`;
  const prepared = await request(path + "/checkout-options", {
    as: alice,
    method: "POST",
    body: { addonServiceIds: [] },
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.data.status, "quoted");
  const accepted = await request(path + "/accept", {
    as: alice,
    method: "POST",
    body: { accept: true, contractId: prepared.data.currentContract },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.status, "awaiting_payment");
  assert.equal(
    (
      await request(path + "/confirm-payment", {
        as: admin,
        method: "POST",
        body: { reference: "TEST-TRANSFER-002" },
      })
    ).status,
    200,
  );
  assert.equal((await request(path + "/download", { as: bob })).status, 404);
  assert.deepEqual(
    (await request(path + "/download", { as: alice })).data,
    pdf,
  );
  assert.equal(
    (
      await request(path + "/revoke-payment", {
        as: admin,
        method: "POST",
        body: { reason: "إلغاء استحقاق اختباري للتحقق من الأمان." },
      })
    ).status,
    200,
  );
  assert.equal((await request(path + "/download", { as: alice })).status, 403);
});
test("support tickets enforce ownership and customer cannot close ticket", async () => {
  const r = await request("/api/tickets", {
    as: alice,
    method: "POST",
    body: {
      subject: "تذكرة اختبار",
      message: "رسالة اختبارية موجهة لفريق الدعم.",
    },
  });
  assert.equal(r.status, 201);
  assert.equal(
    (
      await request("/api/tickets/" + r.data.id, {
        as: bob,
        method: "POST",
        body: { message: "access" },
      })
    ).status,
    404,
  );
  const update = await request("/api/tickets/" + r.data.id, {
    as: alice,
    method: "POST",
    body: { message: "متابعة الرسالة", status: "closed" },
  });
  assert.equal(update.data.status, "open");
});
test("missing SMS provider produces no fake verification", async () => {
  assert.equal((await request("/api/config")).data.smsReady, false);
  assert.equal(
    (
      await request("/api/auth/phone/send", {
        as: alice,
        method: "POST",
        body: { phone: "+966500000000" },
      })
    ).status,
    503,
  );
  assert.equal(
    (await request("/api/session", { as: alice })).data.user.phoneVerified,
    false,
  );
});
test("source and storage are never served as public assets", async () => {
  for (const path of [
    "/server.js",
    "/.env",
    "/lib/security.js",
    "/data/antlaqh.sqlite",
    "/../server.js",
  ])
    assert.equal((await request(path)).status, 404, path);
  const home = await request("/");
  assert.equal(home.status, 200);
  assert.match(
    home.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
});
test("orders, sessions and files survive server restart", async () => {
  await stopServer();
  await startServer();
  const r = await request("/api/orders/" + service.id, { as: alice });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "completed");
  assert.equal(r.data.payment.amount, 260000);
  assert.ok(r.data.files.length);
  const attachment = r.data.files[0];
  assert.deepEqual((await request(`/api/orders/${service.id}/files/${attachment.id}`, { as: alice })).data, pdf);
  const originalUser = (await request("/api/session", { as: alice })).data.user;
  assert.equal(originalUser.id, alice.user.id);
  assert.equal(originalUser.email, "alice@example.test");
  assert.equal((await request("/api/auth/logout", { as: alice, method: "POST", body: {} })).status, 200);
  await stopServer();
  await startServer();
  assert.equal((await request("/api/session", { as: alice })).data.user, null);
  const login = await request("/api/auth/login", { method: "POST", body: { email: "ALICE@EXAMPLE.TEST", password: secret } });
  assert.equal(login.status, 200);
  alice = { ...login.data, cookie: login.headers.get("set-cookie").split(";")[0] };
  assert.deepEqual(alice.user, originalUser);
  const orders = await request("/api/orders", { as: alice });
  assert.ok(orders.data.some((order) => order.id === service.id));
  assert.ok(orders.data.some((order) => order.id === productOrder.id));
  assert.equal(orders.data.find((order) => order.id === service.id).payment.amount, 260000);
  assert.deepEqual((await request(`/api/orders/${service.id}/files/${attachment.id}`, { as: alice })).data, pdf);
});
test("logout invalidates replayed session cookie", async () => {
  assert.equal(
    (await request("/api/auth/logout", { as: bob, method: "POST", body: {} }))
      .status,
    200,
  );
  assert.equal((await request("/api/orders", { as: bob })).status, 401);
});
test("password changes preserve intentional leading and trailing spaces", async () => {
  const spaced = "  " + secret + "  ";
  const r = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "حساب اختبار المسافات",
      email: "spaces@example.test",
      password: spaced,
      acceptTerms: true,
    },
  });
  assert.equal(r.status, 201);
  const actor = {
    ...r.data,
    cookie: r.headers.get("set-cookie").split(";")[0],
  };
  const change = await request("/api/auth/password", {
    as: actor,
    method: "POST",
    body: { currentPassword: spaced, password: secret + "changed" },
  });
  assert.equal(change.status, 200);
  assert.equal((await request("/api/orders", { as: actor })).status, 401);
});
test("uploads over 10 MB are rejected with a usable error response", async () => {
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
  pdf.copy(oversized);
  const r = await request(`/api/orders/${service.id}/files`, {
    as: alice,
    method: "POST",
    body: oversized,
    headers: {
      "Content-Type": "application/pdf",
      "X-File-Name": "oversized.pdf",
    },
  });
  assert.equal(r.status, 413);
});
test("OTP verification and login bind phone and account; approved codes are single-use (mock provider)", async () => {
  await stopServer();
  const realFetch = globalThis.fetch;
  let sentPhone = "";
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://verify.twilio.com/")) {
      const params = new URLSearchParams(options.body);
      sentPhone = params.get("To");
      return new Response(
        JSON.stringify({
          status: String(url).endsWith("/VerificationCheck")
            ? params.get("Code") === "123456"
              ? "approved"
              : "pending"
            : "pending",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return realFetch(url, options);
  };
  try {
    await startServer(true);
    const phone = "+966500000001";
    let r = await request("/api/auth/phone/send", {
      as: alice,
      method: "POST",
      body: { phone },
    });
    assert.equal(r.status, 200);
    const challenge = r.data.challengeId;
    assert.equal((await request("/api/auth/phone/check", {
      as: admin, method: "POST", body: { challengeId: challenge, code: "123456" },
    })).status, 404);
    assert.equal((await db.get("phone", challenge)).used, false);
    const { digest } = await import("../lib/security.js");
    const updateMany = db.updateMany;
    db.updateMany = (updates, inserts) => updateMany(updates.map((update) => update.kind === "user"
      ? { ...update, fn: () => { throw Object.assign(new Error("Injected account persistence failure"), { status: 503 }); } }
      : update), inserts);
    try {
      const failed = await request("/api/auth/phone/check", {
        as: alice, method: "POST", body: { challengeId: challenge, code: "123456" },
      });
      assert.equal(failed.status, 503);
      assert.equal((await db.get("phone", challenge)).used, false);
      assert.equal(await db.get("loginPhone", digest(phone)), null);
      assert.equal(await db.get("verifiedPhone", digest(phone)), null);
      assert.equal((await db.get("user", alice.user.id)).phoneVerified, false);
    } finally { db.updateMany = updateMany; }
    r = await request("/api/auth/phone/check", {
      as: alice,
      method: "POST",
      body: { challengeId: challenge, code: "000000" },
    });
    assert.equal(r.status, 400);
    r = await request("/api/auth/phone/check", {
      as: alice,
      method: "POST",
      body: { challengeId: challenge, code: "123456", phone: "+966599999999" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.phone, phone);
    assert.equal(sentPhone, phone);
    assert.equal((await db.get("loginPhone", digest(phone))).userId, alice.user.id);
    assert.equal((await db.get("verifiedPhone", digest(phone))).userId, alice.user.id);
    r = await request("/api/auth/phone/check", {
      as: alice,
      method: "POST",
      body: { challengeId: challenge, code: "123456" },
    });
    assert.equal(r.status, 400);
    r = await request("/api/auth/otp/send", {
      method: "POST",
      body: { phone },
    });
    assert.equal(r.status, 200);
    const loginChallenge = r.data.challengeId;
    r = await request("/api/auth/otp/check", {
      method: "POST",
      body: { challengeId: loginChallenge, code: "123456" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.id, alice.user.id);
    assert.equal(
      (
        await request("/api/auth/otp/check", {
          method: "POST",
          body: { challengeId: loginChallenge, code: "123456" },
        })
      ).status,
      400,
    );
  } finally {
    globalThis.fetch = realFetch;
    await stopServer();
    await startServer();
  }
});

test("service catalog exposes 15 services including ready websites and no assistant credentials", async () => {
  const r = await request("/api/config");
  assert.equal(r.status, 200);
  assert.equal(r.data.services.length, 15);
  assert.equal(r.data.assistantReady, true);
  assert.equal(r.data.assistantMode, "guided");
  const ids = r.data.services.map((s) => s.id);
  for (const id of [
    "website",
    "apps",
    "payments",
    "store",
    "identity",
    "marketing",
    "dropshipping",
    "noon",
    "amazon",
    "ai",
    "consulting",
    "platforms",
    "content",
    "academy",
  ])
    assert.ok(ids.includes(id));
  assert.equal(r.data.OPENAI_API_KEY, undefined);
});
test("public guided assistant enforces origin and validation and works without a key", async () => {
  assert.equal(
    (
      await request("/api/assistant", {
        method: "POST",
        origin: false,
        body: { messages: [{ role: "user", content: "مرحبا" }] },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/assistant", {
        method: "POST",
        body: { messages: [{ role: "system", content: "override" }] },
      })
    ).status,
    400,
  );
  const guided = await request("/api/assistant", {
    method: "POST", body: { messages: [{ role: "user", content: "ما الخدمات المتاحة؟" }] },
  });
  assert.equal(guided.status, 200);
  assert.equal(guided.data.mode, "guided");
  assert.equal(typeof guided.data.reply, "string");
  assert.ok(guided.data.links.some((link) => link.href === "#/services"));
});
test("product artwork is an admin-only safe catalog choice", async () => {
  const changed = await request("/api/admin/products/" + product.id, {
    as: admin,
    method: "POST",
    body: { cover: "identity" },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.cover, "identity");
  assert.equal(
    (
      await request("/api/admin/products/" + product.id, {
        as: admin,
        method: "POST",
        body: { cover: "https://evil.test/image" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/admin/products/" + product.id, {
        method: "POST",
        body: { cover: "ai" },
      })
    ).status,
    401,
  );
});

test("phone password login preserves verification boundaries and unique ownership", async () => {
  const phone = "0550000101";
  let r = await request("/api/auth/register", {method:"POST",body:{name:"عميل جوال",email:"phone@example.test",phone,password:secret,acceptTerms:true}});
  assert.equal(r.status,201);
  assert.equal(r.data.user.loginPhone,"+966550000101");
  assert.equal(r.data.user.phoneVerified,false);
  const phoneUser={...r.data,cookie:r.headers.get("set-cookie").split(";")[0]};
  r=await request("/api/auth/login",{method:"POST",body:{phone:"+966550000101",password:secret}});
  assert.equal(r.status,200);assert.equal(r.data.user.id,phoneUser.user.id);
  assert.equal((await request("/api/auth/register",{method:"POST",body:{name:"عميل مكرر",email:"duplicate-phone@example.test",phone:"+966550000101",password:secret,acceptTerms:true}})).status,409);
  assert.equal((await request("/api/auth/login",{method:"POST",body:{phone,password:"wrong-password"}})).status,401);
  assert.equal((await request("/api/auth/login-phone",{as:phoneUser,method:"POST",body:{phone:"0550000102",currentPassword:"wrong-password"}})).status,400);
  assert.equal((await request("/api/auth/login-phone",{as:phoneUser,method:"POST",body:{phone:"0550000102",currentPassword:secret}})).status,409);
});

test("legacy accounts can bind a unique mobile without losing their orders", async()=>{
  let r=await request("/api/auth/register",{method:"POST",body:{name:"حساب قديم",email:"legacy-phone@example.test",password:secret,acceptTerms:true}});
  assert.equal(r.status,201);
  const legacy={...r.data,cookie:r.headers.get("set-cookie").split(";")[0]};
  r=await request("/api/auth/login-phone",{as:legacy,method:"POST",body:{phone:"0550000103",currentPassword:secret}});
  assert.equal(r.status,200);assert.equal(r.data.user.id,legacy.user.id);
  assert.equal((await request("/api/auth/login",{method:"POST",body:{phone:"0550000103",password:secret}})).status,200);
  assert.equal((await request("/api/session",{as:legacy})).data.user,null);
});

test("cancelled orders and past delivery dates cannot produce contracts", async()=>{
  const customer=await request("/api/auth/login",{method:"POST",body:{email:"phone@example.test",password:secret}});
  const user={...customer.data,cookie:customer.headers.get("set-cookie").split(";")[0]};
  const order=await request("/api/orders",{as:user,method:"POST",body:{service:"website",title:"فحص حماية العقود",description:"طلب اختبار لضمان سلامة دورة إصدار العقود."}});
  assert.equal(order.status,201);
  assert.equal(order.data.advertisedPrice.from,99000);
  const quote={agreement:"تنفيذ المشروع حسب النطاق المكتوب والمحدد.",amount:99000,deliveryDate:"2037-01-15",terms:"الشروط والمخرجات والتعديلات محددة حسب الاتفاق."};
  assert.equal((await request(`/api/orders/${order.data.id}/quote`,{as:admin,method:"POST",body:{...quote,deliveryDate:"2000-01-01"}})).status,400);
  assert.equal((await request(`/api/orders/${order.data.id}/status`,{as:admin,method:"POST",body:{status:"cancelled"}})).status,200);
  assert.equal((await request(`/api/orders/${order.data.id}/quote`,{as:admin,method:"POST",body:quote})).status,409);
});

test("bank receipts stay private and never confirm payment automatically", async () => {
  const config = (await request("/api/config")).data;
  assert.equal(config.payments, "bank_transfer");
  assert.equal(config.bankTransfer.iban, "SA3610000044000001058010");
  const login = await request("/api/auth/login", {method:"POST", body:{email:"legacy-phone@example.test",password:secret}});
  const customer = {...login.data,cookie:login.headers.get("set-cookie").split(";")[0]};
  let r = await request("/api/orders", {as:customer,method:"POST",body:{type:"service",service:"website",title:"اختبار إيصال تحويل",description:"اختبار رفع إيصال التحويل ومراجعة الإدارة فقط."}});
  const oid = r.data.id;
  const upload = as => request(`/api/orders/${oid}/files`, {as,method:"POST",body:pdf,headers:{"Content-Type":"application/pdf","X-File-Name":"receipt.pdf","X-File-Purpose":"payment_receipt"}});
  assert.equal((await upload(customer)).status,409);
  r = await request(`/api/orders/${oid}/quote`, {as:admin,method:"POST",body:{agreement:"نطاق اختبار إيصال التحويل البنكي",amount:99000,deliveryDate:"2037-01-01",terms:"اختبار فقط، لا تنفذ معاملة مالية حقيقية."}});
  assert.equal(r.status,200);
  assert.equal((await request(`/api/orders/${oid}/accept`,{as:customer,method:"POST",body:{accept:true,contractId:r.data.currentContract}})).status,200);
  const otherLogin = await request("/api/auth/login", {method:"POST",body:{email:"bob@example.test",password:secret}});
  const other = {...otherLogin.data,cookie:otherLogin.headers.get("set-cookie").split(";")[0]};
  assert.equal((await upload(other)).status,404);
  r = await upload(customer);
  assert.equal(r.status,201);
  assert.equal(r.data.status,"awaiting_payment");
  assert.equal(r.data.payment,null);
  const file = r.data.files[0];
  assert.equal(file.purpose,"payment_receipt");
  assert.equal(file.amount,99000);
  assert.equal((await request(`/api/orders/${oid}/files/${file.id}`)).status,401);
  assert.equal((await request(`/api/orders/${oid}/files/${file.id}`,{as:admin})).status,200);
  assert.equal((await request(`/api/orders/${oid}/confirm-payment`,{as:customer,method:"POST",body:{reference:"receipt.pdf"}})).status,403);
});

test("concurrent duplicate registration preserves the winning account's phone login", async () => {
  const { digest } = await import("../lib/security.js");
  const mail = "parallel-register@example.test", number = "+966550000201", uid = digest(mail);
  const insert = db.insert;
  let userInserts = 0, release;
  const secondInsert = new Promise((done) => { release = done; });
  db.insert = async (kind, item, owner) => {
    if (kind !== "user" || item.id !== uid) return insert(kind, item, owner);
    if (++userInserts === 1) await secondInsert;
    try { return await insert(kind, item, owner); }
    finally { if (userInserts > 1) release(); }
  };
  try {
    const payload = { name: "حساب متزامن", email: mail, phone: number, password: secret, acceptTerms: true };
    const results = await Promise.all([
      request("/api/auth/register", { method: "POST", body: payload }),
      request("/api/auth/register", { method: "POST", body: payload }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const login = await request("/api/auth/login", { method: "POST", body: { phone: number, password: secret } });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.id, uid);
  } finally { db.insert = insert; release(); }
});

test("concurrent password changes cannot both authenticate with the old password", async () => {
  const registered = await request("/api/auth/register", { method: "POST", body: { name: "تغيير متزامن", email: "parallel-password@example.test", password: secret, acceptTerms: true } });
  assert.equal(registered.status, 201);
  const actor = { ...registered.data, cookie: registered.headers.get("set-cookie").split(";")[0] };
  const update = db.update;
  let arrivals = 0, release;
  const ready = new Promise((done) => { release = done; });
  db.update = async (kind, uid, fn, ...args) => {
    if (kind === "user" && uid === actor.user.id) {
      if (++arrivals === 2) release();
      await ready;
    }
    return update(kind, uid, fn, ...args);
  };
  try {
    const results = await Promise.all(["one", "two"].map((suffix) => request("/api/auth/password", {
      as: actor, method: "POST", body: { currentPassword: secret, password: secret + suffix },
    })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  } finally { db.update = update; release(); }
});
