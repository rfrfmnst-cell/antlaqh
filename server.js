import http from "node:http";
import { services, coverKeys } from "./lib/catalog.js";
import { createAssistant } from "./lib/assistant.js";
import { isIP } from "node:net";
import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./lib/store.js";
import {
  id,
  digest,
  fail,
  text,
  email,
  password,
  hashPassword,
  checkPassword,
  publicUser,
  body,
  jsonBody,
  validFile,
} from "./lib/security.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const origin = new URL(process.env.APP_URL || `http://localhost:${port}`)
  .origin;
const dataDir = resolve(process.env.DATA_DIR || join(root, "data"));
const driver = process.env.DB_DRIVER || "sqlite";
if (
  production &&
  (driver !== "mysql" ||
    !process.env.DB_HOST ||
    !process.env.DB_NAME ||
    !process.env.DB_USER)
)
  throw Error("Production requires configured MySQL.");
if (
  production &&
  (!process.env.APP_URL ||
    !origin.startsWith("https://") ||
    !process.env.DATA_DIR ||
    !(
      /^\//.test(process.env.DATA_DIR) ||
      /^[A-Za-z]:[\\/]/.test(process.env.DATA_DIR)
    ))
)
  throw Error(
    "Production requires HTTPS APP_URL and an absolute persistent DATA_DIR outside the checkout.",
  );
if (
  production &&
  (dataDir === root ||
    dataDir.startsWith(root + sep) ||
    dataDir.startsWith(join(root, "public")))
)
  throw Error("DATA_DIR must be outside the deployed checkout.");
await mkdir(join(dataDir, "files"), { recursive: true });
const db = await createStore({ driver, dir: dataDir });
const now = () => new Date().toISOString();
const assistant = createAssistant({
  getCatalog: async () => ({
    services,
    products: (await db.list("product"))
      .filter((p) => p.published && p.file)
      .slice(0, 30)
      .map((p) => ({
        title: p.title,
        category: p.category,
        description: p.description.slice(0, 500),
        priceSAR: p.amount / 100,
      })),
  }),
});
function validCover(value) {
  if (!coverKeys.includes(value))
    throw fail(400, "اختر صورة من مكتبة الخدمات.");
  return value;
}
const smsReady = !!(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_VERIFY_SERVICE_SID
);
const normalizedIp = (value) => String(value).replace(/^::ffff:/, "");
const trustedProxies = new Set(
  (process.env.TRUSTED_PROXY_IPS || "")
    .split(",")
    .map((v) => normalizedIp(v.trim()))
    .filter(Boolean),
);
function clientIp(req) {
  let peer = normalizedIp(req.socket.remoteAddress || "unknown");
  if (!trustedProxies.has(peer)) return peer;
  const chain = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((v) => normalizedIp(v.trim()))
    .filter((v) => isIP(v));
  for (let i = chain.length - 1; i >= 0 && trustedProxies.has(peer); i--)
    peer = chain[i];
  return peer;
}
const limits = new Map();
function rate(key, max, window = 15 * 60 * 1000) {
  const current = Date.now();
  let v = limits.get(key);
  if (!v || v.until < current) v = { count: 0, until: current + window };
  if (++v.count > max)
    throw fail(429, "محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.");
  limits.set(key, v);
}
const cleanup = setInterval(() => {
  for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
}, 60_000);
cleanup.unref();
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function cookie(res, token, age = 604800) {
  res.setHeader(
    "Set-Cookie",
    `antlaqh_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? "; Secure" : ""}`,
  );
}
async function session(req) {
  const match = (req.headers.cookie || "").match(
    /(?:^|;\s*)antlaqh_session=([a-f0-9]{36})(?:;|$)/,
  );
  if (!match) return null;
  const s = await db.get("session", digest(match[1]));
  if (!s || s.expires < Date.now()) return null;
  const u = await db.get("user", s.userId);
  if (!u || u.disabled || s.passwordVersion !== (u.passwordVersion || 0))
    return null;
  return { s, u };
}
async function login(res, u) {
  const token = id();
  const s = {
    id: digest(token),
    userId: u.id,
    csrf: id(),
    expires: Date.now() + 7 * 86400_000,
    passwordVersion: u.passwordVersion || 0,
  };
  await db.insert("session", s, u.id);
  cookie(res, token);
  return { user: publicUser(u), csrf: s.csrf };
}
function authorize(auth, admin = false) {
  if (!auth) throw fail(401, "سجّل الدخول للمتابعة.");
  if (admin && auth.u.role !== "admin")
    throw fail(403, "هذه العملية متاحة للإدارة فقط.");
  return auth.u;
}
function owned(item, auth) {
  authorize(auth);
  if (!item || (item.owner !== auth.u.id && auth.u.role !== "admin"))
    throw fail(404, "لم يتم العثور على السجل.");
  return item;
}
function event(o, message, actor) {
  o.events.push({
    id: id(),
    message,
    at: now(),
    actor: actor.role === "admin" ? "فريق انطلاقة" : actor.name,
  });
  o.updatedAt = now();
}
function amount(v) {
  if (!Number.isSafeInteger(v) || v < 100 || v > 100000000)
    throw fail(400, "أدخل مبلغًا صالحًا لا يقل عن ريال واحد.");
  return v;
}
function safeProduct(p, admin = false) {
  const { file, ...item } = p;
  return { ...item, hasFile: !!file, ...(admin ? { file } : {}) };
}
function safeOrder(o) {
  return o;
}
async function saveFile(req) {
  const contentType = (req.headers["content-type"] || "").split(";")[0];
  const buffer = await body(req, 10 * 1024 * 1024);
  validFile(buffer, contentType);
  let name;
  try {
    name = decodeURIComponent(req.headers["x-file-name"] || "ملف");
  } catch {
    throw fail(400, "اسم الملف غير صحيح.");
  }
  name = name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 140);
  const f = {
    id: id(),
    name,
    mime: contentType,
    size: buffer.length,
    at: now(),
  };
  await writeFile(join(dataDir, "files", f.id), buffer, { flag: "wx" });
  return f;
}
async function sendFile(res, f) {
  if (!f || !/^[a-f0-9]{36}$/.test(f.id)) throw fail(404, "الملف غير موجود.");
  let buffer;
  try {
    buffer = await readFile(join(dataDir, "files", f.id));
  } catch {
    throw fail(404, "الملف غير متاح. تواصل مع الدعم.");
  }
  res.writeHead(200, {
    "Content-Type": f.mime,
    "Content-Disposition": `attachment; filename="download${extname(f.name).replace(/[^.a-z0-9]/gi, "")}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    "Content-Length": buffer.length,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buffer);
}
async function twilio(path, data) {
  if (!smsReady)
    throw fail(
      503,
      "التحقق بالجوال غير مفعّل حاليًا. يمكنك استخدام حسابك بالبريد وكلمة المرور.",
    );
  let response;
  try {
    response = await fetch(
      `https://verify.twilio.com/v2/Services/${encodeURIComponent(process.env.TWILIO_VERIFY_SERVICE_SID)}/${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(data),
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw fail(503, "تعذر الاتصال بخدمة الرسائل، حاول لاحقًا.");
  }
  if (!response.ok)
    throw fail(
      response.status === 429 ? 429 : 400,
      "تعذر إتمام التحقق. تأكد من الرقم والرمز ثم حاول مجددًا.",
    );
  return response.json();
}

if (process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
  const mail = email(process.env.BOOTSTRAP_ADMIN_EMAIL),
    uid = digest(mail);
  if (!(await db.get("user", uid)))
    await db.insert(
      "user",
      {
        id: uid,
        name: "إدارة انطلاقة",
        email: mail,
        role: "admin",
        password: await hashPassword(
          password(process.env.BOOTSTRAP_ADMIN_PASSWORD),
        ),
        createdAt: now(),
      },
      uid,
    );
  else if ((await db.get("user", uid)).role !== "admin")
    throw Error(
      "Bootstrap email already belongs to a customer. Choose a new admin email.",
    );
}

async function api(req, res, url) {
  const path = url.pathname,
    method = req.method;
  const ip = clientIp(req);
  if (!["GET", "HEAD"].includes(method)) {
    if (req.headers.origin !== origin)
      throw fail(403, "طلب من مصدر غير مسموح. أعد فتح المنصة.");
    rate(`write:${ip}`, 150);
  }
  const auth = await session(req);
  const publicWrite = [
    "/api/assistant",
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/otp/send",
    "/api/auth/otp/check",
  ];
  if (!["GET", "HEAD"].includes(method) && !publicWrite.includes(path)) {
    authorize(auth);
    if (req.headers["x-csrf-token"] !== auth.s.csrf)
      throw fail(403, "انتهت صلاحية الصفحة. أعد تحميلها ثم حاول.");
  }
  if (method === "GET" && path === "/api/health")
    return json(res, 200, { status: "ok", version: "5.0.0" });
  if (method === "GET" && path === "/api/config")
    return json(res, 200, {
      services,
      smsReady,
      assistantReady: assistant.ready,
      businessEmail: process.env.BUSINESS_EMAIL || "",
      businessPhone: process.env.BUSINESS_PHONE || "",
      payments: "manual",
      environment: production ? "production" : "development",
    });
  if (method === "POST" && path === "/api/assistant") {
    rate(`assistant:${ip}`, 8, 5 * 60 * 1000);
    rate(`assistant-day:${ip}`, 40, 24 * 60 * 60 * 1000);
    const b = await jsonBody(req);
    return json(res, 200, await assistant.reply(b?.messages));
  }
  if (method === "GET" && path === "/api/session")
    return json(
      res,
      200,
      auth ? { user: publicUser(auth.u), csrf: auth.s.csrf } : { user: null },
    );
  if (method === "POST" && path === "/api/auth/register") {
    rate(`register:${ip}`, 8);
    const b = await jsonBody(req);
    const mail = email(b.email),
      uid = digest(mail);
    const u = {
      id: uid,
      name: text(b.name, 2, 100),
      email: mail,
      password: await hashPassword(password(b.password)),
      role: "customer",
      phoneVerified: false,
      createdAt: now(),
    };
    if (b.acceptTerms !== true)
      throw fail(400, "يلزم الاطلاع على الشروط والخصوصية والموافقة عليهما.");
    u.termsAcceptedAt = now();
    try {
      await db.insert("user", u, uid);
    } catch (e) {
      if (
        e.code === "ER_DUP_ENTRY" ||
        String(e.message).includes("UNIQUE constraint")
      )
        throw fail(409, "هذا البريد مسجّل بالفعل. استخدم تسجيل الدخول.");
      throw e;
    }
    return json(res, 201, await login(res, u));
  }
  if (method === "POST" && path === "/api/auth/login") {
    const b = await jsonBody(req),
      mail = email(b.email);
    rate(`login:${digest(mail)}`, 10);
    rate(`login-ip:${ip}`, 35);
    const u = await db.get("user", digest(mail));
    const valid =
      typeof b.password === "string" &&
      b.password.length <= 128 &&
      u &&
      (await checkPassword(b.password, u.password));
    if (!valid || u.disabled)
      throw fail(401, "البريد أو كلمة المرور غير صحيحة.");
    if (auth) await db.remove("session", auth.s.id);
    return json(res, 200, await login(res, u));
  }
  if (method === "POST" && path === "/api/auth/logout") {
    await db.remove("session", auth.s.id);
    cookie(res, "", 0);
    return json(res, 200, { ok: true });
  }
  if (method === "POST" && path === "/api/auth/password") {
    const b = await jsonBody(req);
    rate(`password:${auth.u.id}`, 5);
    if (
      typeof b.currentPassword !== "string" ||
      b.currentPassword.length > 128 ||
      !(await checkPassword(b.currentPassword, auth.u.password))
    )
      throw fail(400, "كلمة المرور الحالية غير صحيحة.");
    const hash = await hashPassword(password(b.password));
    const updated = await db.update("user", auth.u.id, (u) => {
      u.password = hash;
      u.passwordVersion = (u.passwordVersion || 0) + 1;
      return u;
    });
    return json(res, 200, await login(res, updated));
  }
  if (method === "POST" && path === "/api/auth/otp/send") {
    if (!smsReady) throw fail(503, "الدخول برمز الجوال غير مفعّل حاليًا.");
    rate(`otp-ip:${ip}`, 15);
    const b = await jsonBody(req),
      phone = text(b.phone, 9, 16);
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone))
      throw fail(400, "استخدم الصيغة الدولية لرقم الجوال.");
    rate(`otp-phone:${digest(phone)}`, 3);
    const registration = await db.get("verifiedPhone", digest(phone));
    const uid = registration?.userId;
    const u = uid ? await db.get("user", uid) : null;
    const cid = id();
    if (u?.phoneVerified && u.phone === phone && !u.disabled) {
      await twilio("Verifications", { To: phone, Channel: "sms" });
      await db.insert("otpLogin", {
        id: cid,
        phone,
        userId: uid,
        expires: Date.now() + 10 * 60 * 1000,
        attempts: 0,
        used: false,
      });
    }
    return json(res, 200, {
      challengeId: cid,
      message: "إذا كان الرقم موثّقًا في حساب، سيصلك رمز التحقق.",
    });
  }
  if (method === "POST" && path === "/api/auth/otp/check") {
    if (!smsReady) throw fail(503, "الدخول برمز الجوال غير مفعّل حاليًا.");
    rate(`otp-check:${ip}`, 30);
    const b = await jsonBody(req),
      cid = text(b.challengeId, 36, 36);
    const c = await db.get("otpLogin", cid);
    if (!c || c.used || c.expires < Date.now() || c.attempts >= 5)
      throw fail(400, "الرمز غير صالح أو منتهي. اطلب رمزًا جديدًا.");
    await db.update("otpLogin", cid, (x) => {
      if (x.used || x.attempts >= 5) throw fail(400, "الرمز غير صالح.");
      x.attempts++;
      return x;
    });
    const result = await twilio("VerificationCheck", {
      To: c.phone,
      Code: text(b.code, 4, 10),
    });
    if (result.status !== "approved") throw fail(400, "رمز التحقق غير صحيح.");
    const u = await db.get("user", c.userId);
    if (!u || u.disabled || !u.phoneVerified || u.phone !== c.phone)
      throw fail(400, "الرمز غير صالح.");
    await db.update("otpLogin", cid, (x) => {
      if (x.used) throw fail(400, "تم استخدام الرمز.");
      x.used = true;
      return x;
    });
    if (auth) await db.remove("session", auth.s.id);
    return json(res, 200, await login(res, u));
  }
  if (method === "POST" && path === "/api/auth/phone/send") {
    rate(`sms:${auth.u.id}`, 3);
    const b = await jsonBody(req),
      phone = text(b.phone, 9, 16);
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone))
      throw fail(400, "استخدم الصيغة الدولية مثل +9665XXXXXXXX.");
    await twilio("Verifications", { To: phone, Channel: "sms" });
    const challenge = {
      id: id(),
      phone,
      owner: auth.u.id,
      expires: Date.now() + 10 * 60 * 1000,
      attempts: 0,
      used: false,
    };
    await db.insert("phone", challenge, auth.u.id);
    return json(res, 200, { challengeId: challenge.id });
  }
  if (method === "POST" && path === "/api/auth/phone/check") {
    const b = await jsonBody(req),
      cid = text(b.challengeId, 36, 36);
    const c = owned(await db.get("phone", cid), auth);
    if (c.used || c.expires < Date.now() || c.attempts >= 5)
      throw fail(400, "انتهى الرمز. اطلب رمزًا جديدًا.");
    await db.update("phone", cid, (x) => {
      if (x.used || x.attempts >= 5) throw fail(400, "اطلب رمزًا جديدًا.");
      x.attempts++;
      return x;
    });
    const result = await twilio("VerificationCheck", {
      To: c.phone,
      Code: text(b.code, 4, 10),
    });
    if (result.status !== "approved") throw fail(400, "رمز التحقق غير صحيح.");
    await db.update("phone", cid, (x) => {
      if (x.used) throw fail(400, "تم استخدام الرمز.");
      x.used = true;
      return x;
    });
    const phoneKey = digest(c.phone);
    let registration = await db.get("verifiedPhone", phoneKey);
    if (!registration) {
      try {
        registration = await db.insert(
          "verifiedPhone",
          { id: phoneKey, userId: auth.u.id },
          auth.u.id,
        );
      } catch (e) {
        registration = await db.get("verifiedPhone", phoneKey);
        if (!registration) throw e;
      }
    }
    if (registration.userId !== auth.u.id)
      throw fail(409, "الرقم موثّق في حساب آخر. تواصل مع الدعم.");
    const u = await db.update("user", auth.u.id, (u) => {
      u.phone = c.phone;
      u.phoneVerified = true;
      return u;
    });
    return json(res, 200, { user: publicUser(u) });
  }
  if (method === "GET" && path === "/api/products")
    return json(
      res,
      200,
      (await db.list("product"))
        .filter((p) => p.published && p.file)
        .map((p) => safeProduct(p)),
    );
  if (method === "POST" && path === "/api/orders") {
    const b = await jsonBody(req);
    rate(`order:${auth.u.id}`, 15);
    const o = {
      id: id(),
      number: `INT-${Date.now().toString(36).toUpperCase()}-${id().slice(0, 4).toUpperCase()}`,
      owner: auth.u.id,
      customer: { name: auth.u.name, email: auth.u.email },
      createdAt: now(),
      updatedAt: now(),
      events: [],
      messages: [],
      files: [],
      contracts: [],
      payment: null,
      status: "received",
    };
    if (b.type === "product") {
      const p = await db.get("product", text(b.productId, 1, 80));
      if (!p || !p.published || !p.file)
        throw fail(404, "المنتج غير متاح للشراء.");
      if (b.acceptTerms !== true)
        throw fail(400, "وافق على شروط الشراء للمتابعة.");
      o.type = "product";
      o.title = p.title;
      o.productId = p.id;
      o.productFile = p.file;
      o.amount = p.amount;
      o.description = p.description;
      o.status = "awaiting_payment";
      o.termsAcceptedAt = now();
    } else {
      const service = services.find((s) => s.id === b.service);
      if (!service) throw fail(400, "اختر الخدمة المطلوبة.");
      o.type = "service";
      o.service = service.id;
      o.title = text(b.title, 3, 160);
      o.description = text(b.description, 15, 8000);
      o.budget = text(b.budget || "", 0, 100);
      o.targetDate = text(b.targetDate || "", 0, 30);
    }
    event(o, "تم استلام الطلب", auth.u);
    await db.insert("order", o, auth.u.id);
    return json(res, 201, safeOrder(o));
  }
  if (method === "GET" && path === "/api/orders") {
    authorize(auth);
    const orders = await db.list(
      "order",
      auth.u.role === "admin" && url.searchParams.get("all") === "1"
        ? undefined
        : auth.u.id,
    );
    return json(
      res,
      200,
      orders
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(safeOrder),
    );
  }
  let m = path.match(/^\/api\/orders\/([a-f0-9]{36})(?:\/(.+))?$/);
  if (m) {
    const oid = m[1],
      action = m[2],
      o = owned(await db.get("order", oid), auth);
    if (method === "GET" && !action) return json(res, 200, safeOrder(o));
    if (method === "POST" && action === "messages") {
      const b = await jsonBody(req),
        message = text(b.message, 1, 4000);
      const result = await db.update("order", oid, (x) => {
        if (x.messages.length >= 500)
          throw fail(400, "وصل سجل المحادثة إلى حده. افتح تذكرة دعم.");
        x.messages.push({
          id: id(),
          message,
          by: auth.u.name,
          role: auth.u.role,
          at: now(),
        });
        event(x, "تمت إضافة رسالة", auth.u);
        return x;
      });
      return json(res, 200, result);
    }
    if (method === "POST" && action === "files") {
      if (o.files.length >= 20)
        throw fail(400, "الحد الأقصى 20 مرفقًا لكل طلب.");
      const f = await saveFile(req);
      f.by = auth.u.name;
      f.role = auth.u.role;
      try {
        const result = await db.update("order", oid, (x) => {
          if (x.files.length >= 20)
            throw fail(400, "وصلت إلى الحد الأقصى للمرفقات.");
          x.files.push(f);
          event(x, "تم إرفاق ملف", auth.u);
          return x;
        });
        return json(res, 201, result);
      } catch (e) {
        await unlink(join(dataDir, "files", f.id));
        throw e;
      }
    }
    if (method === "GET" && action?.startsWith("files/")) {
      const f = o.files.find((f) => f.id === action.split("/")[1]);
      return sendFile(res, f);
    }
    if (method === "GET" && action === "download") {
      if (o.type !== "product" || !o.payment?.confirmed || o.payment.revoked)
        throw fail(403, "يتاح التنزيل بعد تأكيد الدفع.");
      return sendFile(res, o.productFile);
    }
    if (method === "POST" && action === "quote") {
      authorize(auth, true);
      const b = await jsonBody(req);
      if (o.type !== "service")
        throw fail(400, "عرض السعر خاص بطلبات الخدمات.");
      const q = {
        id: id(),
        version: o.contracts.length + 1,
        agreement: text(b.agreement, 10, 10000),
        amount: amount(b.amount),
        deliveryDate: text(b.deliveryDate, 10, 10),
        terms: text(b.terms, 10, 10000),
        createdAt: now(),
        acceptedAt: null,
      };
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(q.deliveryDate) ||
        !Number.isFinite(Date.parse(q.deliveryDate)) ||
        new Date(q.deliveryDate).toISOString().slice(0, 10) !== q.deliveryDate
      )
        throw fail(400, "أدخل تاريخ التسليم الصحيح.");
      const result = await db.update("order", oid, (x) => {
        if (x.payment?.confirmed && !x.payment.revoked)
          throw fail(409, "لا يمكن تعديل عرض مدفوع.");
        q.version = x.contracts.length + 1;
        x.contracts.push(q);
        x.currentContract = q.id;
        x.amount = q.amount;
        x.status = "quoted";
        event(x, `صدر عرض السعر والعقد، الإصدار ${q.version}`, auth.u);
        return x;
      });
      return json(res, 200, result);
    }
    if (method === "POST" && action === "accept") {
      if (auth.u.id !== o.owner)
        throw fail(403, "الموافقة متاحة لصاحب الطلب فقط.");
      const b = await jsonBody(req);
      if (b.accept !== true) throw fail(400, "يلزم تأكيد الموافقة.");
      const result = await db.update("order", oid, (x) => {
        const q = x.contracts.find((q) => q.id === x.currentContract);
        if (!q || q.id !== b.contractId || x.status !== "quoted")
          throw fail(409, "العرض تغيّر أو لم يعد بانتظار الموافقة.");
        q.acceptedAt = now();
        q.acceptedBy = auth.u.id;
        x.status = "awaiting_payment";
        event(x, "وافق العميل على العرض والعقد", auth.u);
        return x;
      });
      return json(res, 200, result);
    }
    if (method === "POST" && action === "confirm-payment") {
      authorize(auth, true);
      const b = await jsonBody(req),
        reference = text(b.reference, 3, 150);
      const result = await db.update("order", oid, (x) => {
        if (x.payment?.confirmed && !x.payment.revoked) return x;
        if (x.status !== "awaiting_payment" || !x.amount)
          throw fail(409, "الطلب غير جاهز لتأكيد الدفع.");
        const old = x.payment;
        x.payment = {
          confirmed: true,
          reference,
          amount: x.amount,
          currency: "SAR",
          at: now(),
          by: auth.u.id,
          invoiceNumber: `INV-${x.number.slice(4)}`,
          previous: old || null,
        };
        x.status = x.type === "product" ? "completed" : "paid";
        event(x, "أكدت الإدارة استلام الدفع", auth.u);
        return x;
      });
      return json(res, 200, result);
    }
    if (method === "POST" && action === "revoke-payment") {
      authorize(auth, true);
      const b = await jsonBody(req),
        reason = text(b.reason, 5, 500);
      const result = await db.update("order", oid, (x) => {
        if (!x.payment?.confirmed || x.payment.revoked)
          throw fail(409, "لا توجد دفعة فعالة.");
        x.payment.revoked = true;
        x.payment.revokedAt = now();
        x.payment.revokedBy = auth.u.id;
        x.payment.reason = reason;
        x.status = "cancelled";
        event(x, "ألغت الإدارة استحقاق الدفع: " + reason, auth.u);
        return x;
      });
      return json(res, 200, result);
    }
    if (method === "POST" && action === "status") {
      authorize(auth, true);
      const b = await jsonBody(req);
      const transitions = {
        received: ["reviewing", "cancelled"],
        reviewing: ["cancelled"],
        quoted: ["cancelled"],
        awaiting_payment: ["cancelled"],
        paid: ["in_progress"],
        in_progress: ["final_review"],
        final_review: ["in_progress", "completed"],
        completed: [],
        cancelled: [],
      };
      const result = await db.update("order", oid, (x) => {
        if (!(transitions[x.status] || []).includes(b.status))
          throw fail(409, "هذا الانتقال غير متاح في المرحلة الحالية.");
        x.status = b.status;
        event(x, text(b.note || "تم تحديث مرحلة المشروع", 2, 1000), auth.u);
        return x;
      });
      return json(res, 200, result);
    }
    throw fail(404, "المسار غير موجود.");
  }
  if (path.startsWith("/api/admin/")) {
    authorize(auth, true);
    if (method === "GET" && path === "/api/admin/summary") {
      const orders = await db.list("order"),
        users = await db.list("user"),
        tickets = await db.list("ticket");
      return json(res, 200, {
        orders: orders.length,
        active: orders.filter(
          (o) => !["completed", "cancelled"].includes(o.status),
        ).length,
        customers: users.filter((u) => u.role === "customer").length,
        revenue: orders.reduce(
          (n, o) =>
            n +
            (o.payment?.confirmed && !o.payment.revoked ? o.payment.amount : 0),
          0,
        ),
        openTickets: tickets.filter((t) => t.status === "open").length,
      });
    }
    if (method === "GET" && path === "/api/admin/customers")
      return json(res, 200, (await db.list("user")).map(publicUser));
    if (method === "GET" && path === "/api/admin/products")
      return json(
        res,
        200,
        (await db.list("product")).map((p) => safeProduct(p, true)),
      );
    if (method === "POST" && path === "/api/admin/products") {
      const b = await jsonBody(req);
      const p = {
        id: id(),
        title: text(b.title, 3, 140),
        description: text(b.description, 10, 5000),
        category: text(b.category, 2, 60),
        amount: amount(b.amount),
        cover: b.cover === undefined ? "website" : validCover(b.cover),
        published: false,
        createdAt: now(),
        file: null,
      };
      await db.insert("product", p);
      return json(res, 201, safeProduct(p, true));
    }
    m = path.match(/^\/api\/admin\/products\/([a-f0-9]{36})(?:\/(file))?$/);
    if (m && method === "POST") {
      const pid = m[1];
      if (!(await db.get("product", pid))) throw fail(404, "المنتج غير موجود.");
      if (m[2] === "file") {
        const f = await saveFile(req);
        try {
          const p = await db.update("product", pid, (p) => {
            p.file = f;
            return p;
          });
          return json(res, 200, safeProduct(p, true));
        } catch (e) {
          await unlink(join(dataDir, "files", f.id));
          throw e;
        }
      }
      const b = await jsonBody(req);
      const p = await db.update("product", pid, (p) => {
        if (b.published === true && !p.file)
          throw fail(400, "ارفع ملف المنتج أولًا.");
        if (b.title !== undefined) p.title = text(b.title, 3, 140);
        if (b.description !== undefined)
          p.description = text(b.description, 10, 5000);
        if (b.amount !== undefined) p.amount = amount(b.amount);
        if (b.category !== undefined) p.category = text(b.category, 2, 60);
        if (b.cover !== undefined) p.cover = validCover(b.cover);
        if (typeof b.published === "boolean") p.published = b.published;
        return p;
      });
      return json(res, 200, safeProduct(p, true));
    }
  }
  if (path === "/api/tickets") {
    authorize(auth);
    if (method === "GET")
      return json(
        res,
        200,
        (
          await db.list(
            "ticket",
            auth.u.role === "admin" ? undefined : auth.u.id,
          )
        ).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    if (method === "POST") {
      rate(`ticket:${auth.u.id}`, 10);
      const b = await jsonBody(req);
      const t = {
        id: id(),
        owner: auth.u.id,
        name: auth.u.name,
        subject: text(b.subject, 3, 180),
        status: "open",
        createdAt: now(),
        messages: [
          {
            message: text(b.message, 10, 5000),
            by: auth.u.name,
            role: auth.u.role,
            at: now(),
          },
        ],
      };
      await db.insert("ticket", t, auth.u.id);
      return json(res, 201, t);
    }
  }
  m = path.match(/^\/api\/tickets\/([a-f0-9]{36})$/);
  if (m && method === "POST") {
    owned(await db.get("ticket", m[1]), auth);
    const b = await jsonBody(req);
    const t = await db.update("ticket", m[1], (t) => {
      if (b.message) {
        if (t.messages.length >= 200) throw fail(400, "افتح تذكرة جديدة.");
        t.messages.push({
          message: text(b.message, 1, 5000),
          by: auth.u.name,
          role: auth.u.role,
          at: now(),
        });
      }
      if (
        b.status &&
        auth.u.role === "admin" &&
        ["open", "closed"].includes(b.status)
      )
        t.status = b.status;
      return t;
    });
    return json(res, 200, t);
  }
  throw fail(404, "المسار غير موجود.");
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  if (production)
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  try {
    const url = new URL(req.url, "http://local");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (!["GET", "HEAD"].includes(req.method))
      throw fail(405, "طريقة غير مدعومة.");
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      throw fail(400, "الرابط غير صالح.");
    }
    if (
      pathname.includes("\0") ||
      pathname.includes("\\") ||
      pathname.split("/").some((p) => p.startsWith("."))
    )
      throw fail(404, "الصفحة غير موجودة.");
    const file = resolve(
      root,
      "public",
      pathname === "/" ? "index.html" : "." + pathname,
    );
    if (!file.startsWith(join(root, "public") + sep))
      throw fail(404, "الصفحة غير موجودة.");
    let content;
    try {
      content = await readFile(file);
    } catch {
      throw fail(404, "الصفحة غير موجودة.");
    }
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": [".html", ".js", ".css"].includes(extname(file))
        ? "no-cache"
        : "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (e) {
    if (e.status === 429) res.setHeader("Retry-After", "900");
    if (!e.status) console.error("Request failed:", e.code || e.name);
    if (!res.headersSent)
      json(res, e.status || 500, {
        error: e.status
          ? e.message
          : "تعذر إتمام العملية. حاول مجددًا أو تواصل مع الدعم.",
      });
    else res.end();
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(port, "0.0.0.0", () =>
  console.log(
    `Antlaqh is ready on port ${server.address().port} (${production ? "production" : "development"})`,
  ),
);
async function shutdown() {
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
export { server, db };
