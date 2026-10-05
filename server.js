import http from "node:http";
import { operationalDashboard } from "./lib/admin-dashboard.js";
import { validateStudy, validateStudyDocuments, studyDocuments } from "./lib/feasibility.js";
import { validateContentProduction, contentProductionSummary } from "./lib/content-production.js";
import { businessVerification } from "./lib/business-verification.js";
import { services, coverKeys, customerJourney, productCheckoutAddonIds } from "./lib/catalog.js";
import { createAssistant } from "./lib/assistant.js";
import { isIP } from "node:net";
import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./lib/store.js";
import { getLaunchOffer, claimPromotion, priceBreakdown } from "./lib/promotion.js";
import { contractMetadata, validateContractDetails, createContractDocument } from "./lib/contracts.js";
import { createRecovery } from "./lib/recovery.js";
import { createMetaWebhook } from "./lib/meta-webhook.js";
import { createEdfapayWebhook, edfapayCallbackPath } from "./lib/edfapay-webhook.js";
import { createEdfapayCheckout } from "./lib/edfapay-checkout.js";
import { createSms } from "./lib/sms.js";
import {
  id,
  digest,
  fail,
  text,
  email,
  password,
  phone as normalizePhone,
  hashPassword,
  checkPassword,
  dummyPasswordHash,
  publicUser,
  body,
  jsonBody,
  validFile,
} from "./lib/security.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const { version: appVersion } = JSON.parse(
  await readFile(new URL("./package.json", import.meta.url), "utf8"),
);
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const origin = new URL(process.env.APP_URL || `http://localhost:${port}`)
  .origin;
const dataDir = resolve(process.env.DATA_DIR || join(root, "data"));
const driver = process.env.DB_DRIVER || "sqlite";
const ga4MeasurementId = /^G-[A-Z0-9]{5,20}$/.test(process.env.GOOGLE_ANALYTICS_ID || "")
  ? process.env.GOOGLE_ANALYTICS_ID : null;
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
const db = await createStore({
  driver,
  dir: dataDir,
  allowSqliteFallback:
    production && process.env.DB_ALLOW_SQLITE_FALLBACK !== "false",
});
const recovery = await createRecovery({ db });
const metaWebhook = createMetaWebhook({ db });
const edfapayWebhook = createEdfapayWebhook({ db, origin });
const edfapayCheckout = createEdfapayCheckout({ origin });
let businessWhatsapp = "966553575760";
try { businessWhatsapp = normalizePhone(process.env.BUSINESS_WHATSAPP_PHONE || "+966553575760").slice(1); } catch {}
const now = () => new Date().toISOString();
const assistant = createAssistant({
  getCatalog: async () => ({
    services,
    customerJourney,
    contact: {
      email: process.env.BUSINESS_EMAIL || "antlaqh2030@gmail.com",
      phone: process.env.BUSINESS_PHONE || "+966553575760",
    },
    launchOffer: getLaunchOffer(),
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
const sms = createSms({ normalizePhone });
const orderStatusLabels = {
  received: "تم استلام الطلب",
  reviewing: "طلبك قيد المراجعة",
  quoted: "عرض السعر والعقد جاهزان للمراجعة",
  awaiting_payment: "تم اعتماد العقد وبانتظار الدفع",
  paid: "تم تأكيد الدفع",
  in_progress: "بدأ تنفيذ طلبك",
  final_review: "طلبك في المراجعة النهائية",
  completed: "تم إكمال طلبك",
  cancelled: "تم إلغاء الطلب",
};
function notifyOrderSms(order, message, trackingToken = "") {
  if (!sms.ready || !order?.customer?.phone) return;
  const tracking =
    trackingToken && order?.id
      ? `\nمتابعة: ${origin}/#/track/${order.id}/${trackingToken}`
      : "";
  const body = `انطلاقة للتجارة الإلكترونية\n${message}\nرقم الطلب: ${order.number}${tracking}`;
  setImmediate(() => {
    sms.send(order.customer.phone, body).catch((error) => {
      console.error("SMS notification failed:", error?.status || error?.message || "unknown_error");
    });
  });
}
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
  if (!u || u.disabled || s.passwordVersion !== (u.passwordVersion || 0) || (s.authVersion || 0) !== (u.authVersion || 0))
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
    authVersion: u.authVersion || 0,
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
  const { trackingTokenHash, ...safe } = o;
  return safe;
}
function checkoutAllowedAddonIds(order) {
  if (order.type === "product") return productCheckoutAddonIds;
  return services.find((service) => service.id === order.service)?.checkoutAddons?.map((addon) => addon.id) || [];
}
function checkoutContractDetails(base, selectedAddons = []) {
  const providerType = ["none", "commercial_registration", "freelance_certificate"].includes(process.env.BUSINESS_REGISTRATION_TYPE)
    ? process.env.BUSINESS_REGISTRATION_TYPE : "none";
  const deliverables = [
    ...(base?.includes || []),
    ...selectedAddons.flatMap((addon) => addon.includes || [addon.title]),
  ];
  return {
    provider: {
      legalName: process.env.BUSINESS_LEGAL_NAME || "إنطلاقة للتجارة الإلكترونية",
      address: process.env.BUSINESS_ADDRESS || "المملكة العربية السعودية",
      registrationNumber: process.env.BUSINESS_REGISTRATION_NUMBER || "",
      registrationType: providerType,
      activity: process.env.BUSINESS_ACTIVITY || "خدمات التجارة الإلكترونية والحلول الرقمية",
    },
    deliverables: deliverables.length ? deliverables.join("\n") : "تسليم المنتج أو الخدمة الموضحة في الطلب وفق الوصف والنطاق المنشور.",
    exclusions: "لا يشمل الاتفاق أعمالًا أو اشتراكات أو رسوم جهات خارجية غير مذكورة صراحة ضمن نطاق الطلب أو الخدمات الإضافية المختارة.",
    clientRequirements: "تزويد فريق إنطلاقة بالمحتوى والبيانات والصلاحيات اللازمة للتنفيذ في الوقت المناسب، ومراجعة المخرجات ضمن المدد الموضحة.",
    thirdPartyCosts: "رسوم الجهات الخارجية مثل الاستضافة والدومين والمتاجر الإعلانية أو واجهات API لا تدخل في السعر إلا إذا ظهرت صراحة ضمن الطلب.",
    revisions: 2,
    reviewDays: 7,
    supportDays: 30,
    ownership: "تنتقل حقوق استخدام المخرجات الخاصة بالعميل بعد سداد المبلغ المتفق عليه، مع بقاء تراخيص وأصول الجهات الخارجية خاضعة لشروط أصحابها.",
    cancellation: "يعالج الإلغاء والاسترداد وفق حالة التنفيذ والأعمال المنجزة والأنظمة المعمول بها، وتوثق أي تسوية داخل الطلب.",
  };
}
async function saveFile(req, studyFile = false) {
  const contentType = (req.headers["content-type"] || "").split(";")[0];
  const buffer = await body(req, 10 * 1024 * 1024);
  validFile(buffer, contentType, studyFile);
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
    uid = digest(mail),
    bootstrapPassword = password(process.env.BOOTSTRAP_ADMIN_PASSWORD),
    existingAdmin = await db.get("user", uid);
  if (!existingAdmin)
    await db.insert(
      "user",
      {
        id: uid,
        name: "إدارة انطلاقة",
        email: mail,
        role: "admin",
        password: await hashPassword(bootstrapPassword),
        passwordVersion: 0,
        authVersion: 0,
        createdAt: now(),
      },
      uid,
    );
  else if (existingAdmin.role !== "admin")
    throw Error(
      "Bootstrap email already belongs to a customer. Choose a new admin email.",
    );
  else if (!(await checkPassword(bootstrapPassword, existingAdmin.password))) {
    await db.update("user", uid, (u) => ({
      ...u,
      password: null,
      passwordVersion: (u.passwordVersion || 0) + 1,
      authVersion: (u.authVersion || 0) + 1,
    }));
    const passwordHash = await hashPassword(bootstrapPassword);
    await db.update("user", uid, (u) => ({
      ...u,
      password: passwordHash,
    }));
  }
}

function isDuplicate(error) {
  return error.code === "ER_DUP_ENTRY" || String(error.message).includes("UNIQUE constraint");
}
function currentAccount(u, auth) {
  if (u.disabled || u.password !== auth.u.password ||
      (u.passwordVersion || 0) !== (auth.u.passwordVersion || 0) ||
      (u.authVersion || 0) !== (auth.u.authVersion || 0))
    throw fail(409, "تغيّرت بيانات الحساب. أعد تسجيل الدخول ثم حاول مجددًا.");
}
async function phoneClaim(number, userId) {
  const key = digest(number);
  const verified = await db.get("verifiedPhone", key);
  if (verified && verified.userId !== userId) throw fail(409, "رقم الجوال مرتبط بحساب آخر.");
  const existing = await db.get("loginPhone", key);
  if (existing) {
    if (existing.userId !== userId) throw fail(409, "رقم الجوال مرتبط بحساب آخر.");
    return null;
  }
  return { kind: "loginPhone", item: { id: key, userId }, owner: userId };
}
async function api(req, res, url) {
  const path = url.pathname,
    method = req.method;
  const ip = clientIp(req);
  if (path === edfapayCallbackPath) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (method !== "POST") {
      res.setHeader("Allow", "POST");
      res.writeHead(405);
      return res.end("ERROR");
    }
    try {
      rate(`edfapay:${ip}`, 120, 60000);
      rate("edfapay:total", 600, 60000);
      const acknowledgement = await edfapayWebhook.receive(req, url.searchParams);
      res.writeHead(200);
      return res.end(acknowledgement);
    } catch (error) {
      if (!error.status) console.error("EdfaPay receipt failed:", error.code || error.name);
      if (error.status === 429) res.setHeader("Retry-After", "60");
      res.writeHead(error.status || 500);
      return res.end("ERROR");
    }
  }
  // Meta signs its server-to-server callbacks; browser session/CSRF rules still apply elsewhere.
  if (path === "/api/webhooks/meta/whatsapp") {
    if (method === "GET") {
      const challenge = metaWebhook.challenge(url.searchParams);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(challenge);
    }
    if (method === "POST") {
      rate(`meta:${ip}`, 600, 60000);
      return json(res, 200, await metaWebhook.receive(req));
    }
    throw fail(405, "طريقة غير مدعومة.");
  }
  if (!["GET", "HEAD"].includes(method)) {
    if (req.headers.origin !== origin)
      throw fail(403, "طلب من مصدر غير مسموح. أعد فتح المنصة.");
    rate(`write:${ip}`, 150);
  }
  const auth = await session(req);
  const trackingSessionMatch = path.match(/^\/api\/track\/([a-f0-9]{36})\/session$/);
  const publicWrite = [
    "/api/assistant",
    "/api/auth/guest",
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/otp/send",
    "/api/auth/otp/check",
    "/api/auth/recovery/request",
    "/api/auth/recovery/verify",
    "/api/auth/recovery/reset",
  ];
  if (!["GET", "HEAD"].includes(method) && !publicWrite.includes(path) && !trackingSessionMatch) {
    authorize(auth);
    if (req.headers["x-csrf-token"] !== auth.s.csrf)
      throw fail(403, "انتهت صلاحية الصفحة. أعد تحميلها ثم حاول.");
  }
  if (method === "GET" && path === "/api/health")
    return json(res, 200, {
      status: "ok",
      version: appVersion,
      databaseMode: db.mode,
      databaseFallback: db.mode === "sqlite-fallback",
      ...(url.searchParams.has("verify-origin")
        ? {
            siteOrigin: origin,
            originHeaderPresent: typeof req.headers.origin === "string",
            originMatches: req.headers.origin === origin,
            originHeaderNames: Object.keys(req.headers).filter((key) =>
              /origin/i.test(key),
            ),
          }
        : {}),
    });
  if (method === "GET" && path === "/api/config")
    return json(res, 200, {
      services,
      productCheckoutAddonIds,
      customerJourney,
      launchOffer: getLaunchOffer(),
      integrations: { ga4MeasurementId },
      contracts: contractMetadata,
      recovery: recovery.readiness,
      channels: {
        whatsapp: { phone: businessWhatsapp, direct: true, automated: false },
        sms: { transactional: sms.ready, provider: sms.provider, mode: sms.mode },
      },
      smsReady,
      smsNotificationsReady: sms.ready,
      assistantReady: assistant.ready,
      assistantMode: assistant.mode,
      businessEmail: process.env.BUSINESS_EMAIL || "antlaqh2030@gmail.com",
      businessPhone: process.env.BUSINESS_PHONE || "+966553575760",
      businessVerification: businessVerification(),
      payments: edfapayCheckout.readiness.configured ? "edfapay_and_bank_transfer" : "bank_transfer",
      paymentMethods: {
        bankTransfer: { available: true },
        edfapay: {
          available: edfapayCheckout.readiness.configured,
          mode: edfapayCheckout.readiness.mode,
          integration: edfapayCheckout.readiness.integration || "api_key",
          requiresBillingAddress: !!edfapayCheckout.readiness.requiresBillingAddress,
          reason: edfapayCheckout.readiness.reason,
        },
      },
      bankTransfer: { bank: "البنك الأهلي السعودي", iban: "SA3610000044000001058010", currency: "SAR" },
      environment: production ? "production" : "development",
      release: appVersion,
      siteOrigin: origin,
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
  if (method === "POST" && trackingSessionMatch) {
    rate(`track-session:${ip}`, 30);
    const oid = trackingSessionMatch[1];
    const b = await jsonBody(req);
    const token = text(b.token, 20, 120);
    const order = await db.get("order", oid);
    if (!order || !order.trackingTokenHash || digest(token) !== order.trackingTokenHash)
      throw fail(404, "رابط متابعة الطلب غير صالح.");
    const user = await db.get("user", order.owner);
    if (!user || user.disabled || user.role !== "customer")
      throw fail(404, "رابط متابعة الطلب غير صالح.");
    return json(res, 200, await login(res, user));
  }
  if (method === "POST" && path === "/api/auth/recovery/request") {
    rate(`recovery-request:${ip}`, 12);
    return json(res, 200, await recovery.request(await jsonBody(req)));
  }
  if (method === "POST" && path === "/api/auth/recovery/verify") {
    rate(`recovery-verify:${ip}`, 30);
    return json(res, 200, await recovery.verify(await jsonBody(req)));
  }
  if (method === "POST" && path === "/api/auth/recovery/reset") {
    rate(`recovery-reset:${ip}`, 12);
    const result = await recovery.reset(await jsonBody(req));
    return json(res, 200, result);
  }
  if (method === "POST" && path === "/api/auth/guest") {
    rate(`guest:${ip}`, 12);
    const b = await jsonBody(req);
    const guestId = id();
    const u = {
      id: guestId,
      name: text(b.name, 2, 100),
      email: email(b.email),
      role: "customer",
      guest: true,
      phoneVerified: false,
      createdAt: now(),
    };
    if (b.phone) u.phone = normalizePhone(b.phone);
    await db.insert("user", u, guestId);
    return json(res, 201, await login(res, u));
  }
  if (method === "POST" && path === "/api/auth/register") {
    rate(`register:${ip}`, 8);
    const b = await jsonBody(req);
    const mail = email(b.email),
      uid = digest(mail);
    if (b.acceptTerms !== true)
      throw fail(400, "يلزم الاطلاع على الشروط والخصوصية والموافقة عليهما.");
    if (await db.get("user", uid))
      throw fail(409, "هذا البريد مسجّل بالفعل. استخدم تسجيل الدخول.");
    const u = {
      id: uid,
      name: text(b.name, 2, 100),
      email: mail,
      password: await hashPassword(password(b.password)),
      role: "customer",
      phoneVerified: false,
      createdAt: now(),
    };
    u.termsAcceptedAt = now();
    let claim;
    if (b.phone) {
      u.loginPhone = normalizePhone(b.phone);
      claim = await phoneClaim(u.loginPhone, uid);
    }
    try {
      await db.insertMany([{ kind: "user", item: u, owner: uid }, ...(claim ? [claim] : [])]);
    } catch (e) {
      if (isDuplicate(e))
        throw fail(409, (await db.get("user", uid))
          ? "هذا البريد مسجّل بالفعل. استخدم تسجيل الدخول."
          : "رقم الجوال مرتبط بحساب آخر.");
      throw e;
    }
    return json(res, 201, await login(res, u));
  }
  if (method === "POST" && path === "/api/auth/login") {
    const b = await jsonBody(req);
    const identifier = b.phone ? normalizePhone(b.phone) : email(b.email);
    rate(`login:${digest(identifier)}`, 10);
    rate(`login-ip:${ip}`, 35);
    let uid = digest(identifier);
    if (b.phone) {
      const mapping = await db.get("loginPhone", digest(identifier)) || await db.get("verifiedPhone", digest(identifier));
      uid = mapping?.userId || "missing";
    }
    const u = await db.get("user", uid);
    const valid =
      typeof b.password === "string" &&
      b.password.length <= 128 &&
      (await checkPassword(b.password, u?.password || dummyPasswordHash));
    if (!valid || !u || u.disabled)
      throw fail(401, "بيانات الدخول أو كلمة المرور غير صحيحة.");
    if (auth) await db.remove("session", auth.s.id);
    return json(res, 200, await login(res, u));
  }
  if (method === "POST" && path === "/api/auth/logout") {
    await db.remove("session", auth.s.id);
    cookie(res, "", 0);
    return json(res, 200, { ok: true });
  }
  if (method === "POST" && path === "/api/auth/login-phone") {
    const b = await jsonBody(req);
    rate(`bind-phone:${auth.u.id}`, 5);
    if (typeof b.currentPassword !== "string" || b.currentPassword.length > 128 || !(await checkPassword(b.currentPassword, auth.u.password)))
      throw fail(400, "كلمة المرور الحالية غير صحيحة.");
    const number = normalizePhone(b.phone);
    // A login identifier is immutable here; changing it requires verified support.
    if (auth.u.loginPhone && auth.u.loginPhone !== number) throw fail(409, "رقم الدخول مرتبط بالفعل. تواصل مع الدعم لتغييره.");
    const claim = await phoneClaim(number, auth.u.id);
    let updated;
    try { updated = await db.update("user", auth.u.id, u => {
      currentAccount(u, auth);
      if (u.loginPhone && u.loginPhone !== number) throw fail(409, "رقم الدخول مرتبط بالفعل.");
      u.loginPhone = number; u.passwordVersion = (u.passwordVersion || 0) + 1; return u;
    }, claim ? [claim] : []); }
    catch (error) { if (isDuplicate(error)) throw fail(409, "رقم الجوال مرتبط بحساب آخر."); throw error; }
    return json(res, 200, await login(res, updated));
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
      currentAccount(u, auth);
      u.password = hash;
      u.passwordVersion = (u.passwordVersion || 0) + 1;
      u.authVersion = (u.authVersion || 0) + 1;
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
      if (x.used || x.expires < Date.now() || x.attempts >= 5) throw fail(400, "الرمز غير صالح.");
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
      if (x.used || x.expires < Date.now()) throw fail(400, "الرمز غير صالح أو منتهي.");
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
    if (c.owner !== auth.u.id) throw fail(404, "لم يتم العثور على السجل.");
    if (c.used || c.expires < Date.now() || c.attempts >= 5)
      throw fail(400, "انتهى الرمز. اطلب رمزًا جديدًا.");
    await db.update("phone", cid, (x) => {
      if (x.used || x.expires < Date.now() || x.attempts >= 5) throw fail(400, "اطلب رمزًا جديدًا.");
      x.attempts++;
      return x;
    });
    const result = await twilio("VerificationCheck", {
      To: c.phone,
      Code: text(b.code, 4, 10),
    });
    if (result.status !== "approved") throw fail(400, "رمز التحقق غير صحيح.");
    const phoneKey = digest(c.phone);
    const claim = await phoneClaim(c.phone, auth.u.id);
    const registration = await db.get("verifiedPhone", phoneKey);
    if (registration && registration.userId !== auth.u.id)
      throw fail(409, "الرقم موثّق في حساب آخر. تواصل مع الدعم.");
    const inserts = [
      ...(claim ? [claim] : []),
      ...(!registration ? [{ kind: "verifiedPhone", item: { id: phoneKey, userId: auth.u.id }, owner: auth.u.id }] : []),
    ];
    let u;
    try {
      [, u] = await db.updateMany([
        { kind: "phone", id: cid, fn: (x) => {
          if (x.used || x.expires < Date.now()) throw fail(400, "الرمز غير صالح أو منتهي.");
          x.used = true;
          return x;
        } },
        { kind: "user", id: auth.u.id, fn: (user) => {
          currentAccount(user, auth);
          user.phone = c.phone;
          user.phoneVerified = true;
          return user;
        } },
      ], inserts);
    } catch (error) {
      if (isDuplicate(error)) throw fail(409, "تغيّر ارتباط رقم الجوال. أعد طلب رمز جديد.");
      throw error;
    }
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
    const createdAt = now();
    const promotion = claimPromotion(b.promoCode, Date.parse(createdAt));
    const trackingToken = id();
    const o = {
      id: id(),
      number: `INT-${Date.now().toString(36).toUpperCase()}-${id().slice(0, 4).toUpperCase()}`,
      owner: auth.u.id,
      customer: { name: auth.u.name, email: auth.u.email, phone: auth.u.phone || "" },
      trackingTokenHash: digest(trackingToken),
      createdAt,
      updatedAt: now(),
      promotion,
      subtotal: null,
      discount: 0,
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
      o.type = "product";
      o.title = p.title;
      o.productId = p.id;
      o.productFile = p.file;
      Object.assign(o, priceBreakdown(p.amount, promotion));
      o.description = p.description;
      o.status = "received";
    } else {
      const service = services.find((s) => s.id === b.service);
      if (!service) throw fail(400, "اختر الخدمة المطلوبة.");
      o.type = "service";
      o.service = service.id;
      o.advertisedPrice = { ...service.pricing };
      if (service.id === "feasibility") {
        o.study = validateStudy(b.study);
        o.advertisedPrice = { ...service.pricing, from: o.study.plan.amount, scope: o.study.plan.includes.join("؛ ") };
      } else if (b.study !== undefined) throw fail(400, "أسئلة الدراسة متاحة لخدمة دراسة الجدوى فقط.");
      if (service.id === "content-production") {
        o.contentProduction = validateContentProduction(b.contentProduction);
        o.advertisedPrice = { ...service.pricing, from:o.contentProduction.quote.amount, scope:contentProductionSummary(o.contentProduction) };
      } else if (b.contentProduction !== undefined) throw fail(400,"خيارات صناعة المحتوى متاحة لهذه الخدمة فقط.");
      if (service.id === "ready-website") {
        const template = service.templates.find(t => t.id === b.template);
        if (!template) throw fail(400, "اختر نموذج الموقع الجاهز.");
        if (b.addons !== undefined && (!Array.isArray(b.addons) || b.addons.length > service.addons.length))
          throw fail(400, "اختر إضافات الموقع من القائمة.");
        const selected = b.addons || [];
        if (selected.some(value => typeof value !== "string" || !service.addons.some(a => a.id === value)) || new Set(selected).size !== selected.length)
          throw fail(400, "إضافات الموقع غير صحيحة.");
        o.siteOptions = { template: { ...template }, addons: service.addons.filter(a => selected.includes(a.id)).map(a => ({ ...a })) };
      } else if (b.addons?.length || b.template) {
        throw fail(400, "إضافات المواقع الجاهزة متاحة لهذا المنتج فقط.");
      }
      o.title = text(b.title, 3, 160);
      o.description = text(b.description, 15, 8000);
      o.budget = text(b.budget || "", 0, 100);
      o.targetDate = text(b.targetDate || "", 0, 30);
    }
    event(o, "تم استلام الطلب", auth.u);
    await db.insert("order", o, auth.u.id);
    notifyOrderSms(o, "استلمنا طلبك وسنراجع التفاصيل.", trackingToken);
    return json(res, 201, { ...safeOrder(o), trackingToken });
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
      const receipt = req.headers["x-file-purpose"] === "payment_receipt";
      if (receipt && o.status !== "awaiting_payment")
        throw fail(409, "يرفع إيصال التحويل بعد اعتماد العرض وقبل تأكيد الدفع.");
      const studyCategory = req.headers["x-study-category"];
      if (studyCategory && (o.service !== "feasibility" || !studyDocuments.some(d => d.id === studyCategory) || receipt))
        throw fail(400, "تصنيف مرفق الدراسة غير صحيح.");
      const f = await saveFile(req, o.service === "feasibility" && !receipt);
      if (studyCategory) f.studyCategory = studyCategory;
      if (receipt) { f.purpose = "payment_receipt"; f.amount = o.amount; f.contractId = o.currentContract || null; }
      f.by = auth.u.name;
      f.role = auth.u.role;
      try {
        const result = await db.update("order", oid, (x) => {
          if (x.files.length >= 20)
            throw fail(400, "وصلت إلى الحد الأقصى للمرفقات.");
          if (receipt && (x.status !== "awaiting_payment" || x.amount !== f.amount || (x.currentContract || null) !== f.contractId))
            throw fail(409, "تغيّر العرض أو حالة الدفع؛ حدّث الصفحة قبل رفع الإيصال.");
          x.files.push(f);
          event(x, receipt ? "تم إرفاق إيصال تحويل بنكي للمراجعة" : "تم إرفاق ملف", auth.u);
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
    if (method === "POST" && action === "study-documents") {
      if (o.service !== "feasibility") throw fail(400, "هذا الطلب ليس دراسة جدوى.");
      const b = await jsonBody(req);
      const result = await db.update("order", oid, (x) => {
        if (!["received", "reviewing"].includes(x.status) || x.currentContract) throw fail(409, "توثق المستندات قبل تجهيز العقد؛ أرسل الاستكمال في محادثة الطلب.");
        x.study.documents = validateStudyDocuments(x.study, b.documents, x.files);
        delete x.study.inputsReviewed;
        event(x, "تم توثيق مستندات الدراسة والمتطلبات الناقصة", auth.u);
        return x;
      });
      return json(res, 200, safeOrder(result));
    }
    if (method === "POST" && action === "checkout-options") {
      if (auth.u.role !== "admin" && auth.u.id !== o.owner)
        throw fail(403, "هذه الخطوة متاحة لصاحب الطلب فقط.");
      const b = await jsonBody(req);
      const selectedIds = b.addonServiceIds === undefined ? [] : b.addonServiceIds;
      if (!Array.isArray(selectedIds) || selectedIds.length > 4 ||
          selectedIds.some((value) => typeof value !== "string") ||
          new Set(selectedIds).size !== selectedIds.length)
        throw fail(400, "اختيارات الخدمات الإضافية غير صحيحة.");
      const allowed = new Set(checkoutAllowedAddonIds(o));
      if (selectedIds.some((value) => !allowed.has(value)))
        throw fail(400, "إحدى الخدمات الإضافية غير متاحة لهذا الطلب.");
      const selectedAddons = selectedIds
        .map((serviceId) => services.find((service) => service.id === serviceId))
        .filter(Boolean);
      const baseService = o.type === "service"
        ? services.find((service) => service.id === o.service)
        : null;
      if (o.study && !o.study.documents) throw fail(409, "أكمل خطوة مستندات دراسة الجدوى قبل العقد.");
      const baseAmount = o.type === "service"
        ? (o.contentProduction?.quote.amount ?? o.study?.plan.amount ?? baseService?.pricing?.from)
        : (o.subtotal || o.amount);
      if (!Number.isSafeInteger(baseAmount) || baseAmount < 100)
        throw fail(409, "تعذر تحديد سعر الطلب الأساسي.");
      const subtotal = baseAmount + selectedAddons.reduce((sum, addon) => sum + (addon.pricing?.from || 0), 0);
      const details = checkoutContractDetails(baseService, selectedAddons);
      if (o.contentProduction) {
        details.deliverables = [contentProductionSummary(o.contentProduction), ...selectedAddons.flatMap(a => a.includes || [a.title])].join("\n");
        details.revisions = o.contentProduction.quote.revisions;
        details.supportDays = 0;
        details.exclusions += "\n" + o.contentProduction.notice;
        details.clientRequirements = "تقديم الشعار والألوان والمحتوى والمراجع، ومواد الفيديو الأصلية عند اختيار المونتاج، مع تأكيد حقوق استخدامها واعتماد الفكرة والنص قبل التنفيذ. تستكمل المواد مع الفريق قبل بدء التنفيذ.";
      }
      if (o.study) {
        details.deliverables = [...o.study.plan.includes, ...selectedAddons.flatMap(a => a.includes || [a.title])].join("\n");
        details.revisions = o.study.plan.revisions;
        details.supportDays = 0;
        details.exclusions += "\n" + o.study.notice;
        details.clientRequirements = "تقديم بيانات صحيحة وعروض أسعار ومعلومات التشغيل والمبيعات. تستكمل البيانات الناقصة بالتنسيق مع الفريق قبل بدء المدة؛ يعتمد العميل أي افتراضات كتابةً. التوقعات تقديرية وليست تعهدًا بالربح أو قبول التمويل.";
      }
      const providerDetails = {
        ...details.provider,
        email: process.env.BUSINESS_EMAIL || "antlaqh2030@gmail.com",
        phone: process.env.BUSINESS_PHONE || "+966553575760",
      };
      const agreementLines = [
        o.type === "service"
          ? (o.contentProduction ? `${baseService.title}: ${contentProductionSummary(o.contentProduction)}` : o.study ? `${o.study.plan.title}: ${o.study.plan.includes.join("؛ ")}\n${o.study.notice}` : `${baseService.title}: ${baseService.pricing.scope}`)
          : `المنتج الرقمي: ${o.title} — ${o.description}`,
        ...selectedAddons.map((addon) => `${addon.title}: ${addon.pricing.scope}`),
      ];
      const q = {
        id: id(),
        version: o.contracts.length + 1,
        agreement: agreementLines.join("\n\n"),
        subtotal,
        deliveryDate: !o.study && !o.contentProduction && o.targetDate && /^\d{4}-\d{2}-\d{2}$/.test(o.targetDate) ? o.targetDate : null,
        terms: "أقر العميل بأنه راجع وصف الطلب والخدمات الإضافية والسعر والشروط والأحكام، وأن التنفيذ يبدأ بعد تأكيد استلام الدفع واستكمال متطلبات البدء.",
        parties: {
          provider: details.provider.legalName,
          customer: { ...o.customer },
        },
        providerDetails,
        currency: "SAR",
        createdAt: now(),
        acceptedAt: null,
      };
      Object.assign(q, priceBreakdown(q.subtotal, o.promotion));
      q.promotion = o.promotion || null;
      q.document = createContractDocument(details, {
        ...q,
        contact: providerDetails,
        customer: o.customer,
        siteOptions: o.siteOptions,
        studyDetails: o.study,
        contentDetails: o.contentProduction,
        serviceDetails: o.study ? { ...baseService, includes:o.study.plan.includes, pricing:{...baseService.pricing,from:o.study.plan.amount,scope:o.study.plan.includes.join("؛ ")} } : baseService,
        selectedAddons,
        requestDetails: {
          title: o.title,
          description: o.description,
          budget: o.budget || "",
          targetDate: o.targetDate || "",
        },
      });
      q.fingerprint = digest(JSON.stringify({
        id: q.id, version: q.version, agreement: q.agreement,
        subtotal: q.subtotal, discount: q.discount, amount: q.amount,
        promotion: q.promotion, deliveryDate: q.deliveryDate, terms: q.terms,
        parties: q.parties, providerDetails: q.providerDetails,
        document: q.document, currency: q.currency,
      }));
      const result = await db.update("order", oid, (x) => {
        if (!["received", "reviewing", "quoted"].includes(x.status))
          throw fail(409, "لا يمكن تعديل إضافات هذا الطلب بعد اعتماد العقد أو بدء الدفع.");
        if (x.payment?.confirmed && !x.payment.revoked)
          throw fail(409, "لا يمكن تعديل طلب مدفوع.");
        q.version = x.contracts.length + 1;
        x.checkoutAddons = selectedAddons.map((addon) => ({
          id: addon.id,
          title: addon.title,
          description: addon.description,
          pricing: { ...addon.pricing },
        }));
        x.contracts.push(q);
        x.currentContract = q.id;
        x.subtotal = q.subtotal;
        x.discount = q.discount;
        x.amount = q.amount;
        x.status = "quoted";
        event(x, selectedAddons.length ? "اختار العميل الخدمات الإضافية وتم تجهيز العقد" : "تخطى العميل الخدمات الإضافية وتم تجهيز العقد", auth.u);
        return x;
      });
      return json(res, 200, safeOrder(result));
    }
    if (method === "POST" && action === "quote") {
      authorize(auth, true);
      const b = await jsonBody(req);
      if (o.type !== "service")
        throw fail(400, "عرض السعر خاص بطلبات الخدمات.");
      const details = validateContractDetails(b.contractDetails);
      const providerDetails = {
        ...details.provider,
        email: process.env.BUSINESS_EMAIL || "antlaqh2030@gmail.com",
        phone: process.env.BUSINESS_PHONE || "+966553575760",
      };
      const q = {
        id: id(),
        version: o.contracts.length + 1,
        agreement: text(b.agreement, 10, 10000),
        subtotal: amount(b.amount),
        deliveryDate: text(b.deliveryDate, 10, 10),
        terms: text(b.terms, 10, 10000),
        parties: {
          provider: details.provider.legalName,
          customer: { ...o.customer },
        },
        providerDetails,
        currency: "SAR",
        createdAt: now(),
        acceptedAt: null,
      };
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(q.deliveryDate) ||
        !Number.isFinite(Date.parse(q.deliveryDate)) ||
        new Date(q.deliveryDate).toISOString().slice(0, 10) !== q.deliveryDate
      )
        throw fail(400, "أدخل تاريخ التسليم الصحيح.");
      if (q.deliveryDate < new Date().toISOString().slice(0, 10))
        throw fail(400, "تاريخ التسليم لا يمكن أن يكون في الماضي.");
      const result = await db.update("order", oid, (x) => {
        if (!["received", "reviewing", "quoted", "awaiting_payment"].includes(x.status))
          throw fail(409, "لا يمكن إصدار عرض لطلب مُلغى أو بدأ تنفيذه.");
        if (x.payment?.confirmed && !x.payment.revoked)
          throw fail(409, "لا يمكن تعديل عرض مدفوع.");
        Object.assign(q, priceBreakdown(q.subtotal, x.promotion));
        q.promotion = x.promotion || null;
        q.document = createContractDocument(details, {
          ...q,
          contact: providerDetails,
          customer: x.customer,
          siteOptions: x.siteOptions,
          studyDetails: x.study,
          contentDetails: x.contentProduction,
          serviceDetails: x.study ? { ...services.find(service => service.id === x.service), includes:x.study.plan.includes, pricing:{ ...x.advertisedPrice } } : services.find((service) => service.id === x.service) || null,
          requestDetails: { title: x.title, description: x.description, budget: x.budget || "", targetDate: x.targetDate || "" },
        });
        q.version = x.contracts.length + 1;
        q.fingerprint = digest(JSON.stringify({
          id: q.id, version: q.version, agreement: q.agreement,
          subtotal: q.subtotal, discount: q.discount, amount: q.amount,
          promotion: q.promotion, deliveryDate: q.deliveryDate, terms: q.terms,
          parties: q.parties, providerDetails: q.providerDetails,
          document: q.document, currency: q.currency,
        }));
        x.contracts.push(q);
        x.currentContract = q.id;
        x.subtotal = q.subtotal;
        x.discount = q.discount;
        x.amount = q.amount;
        x.status = "quoted";
        event(x, `صدر عرض السعر والعقد، الإصدار ${q.version}`, auth.u);
        return x;
      });
      notifyOrderSms(result, "عرض السعر والعقد جاهزان للمراجعة.");
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
        q.acceptance = {
          customer: { ...x.customer },
          at: q.acceptedAt,
          contractId: q.id,
          version: q.version,
          fingerprint: q.fingerprint || null,
        };
        x.status = "awaiting_payment";
        event(x, "وافق العميل على العرض والعقد", auth.u);
        return x;
      });
      return json(res, 200, result);
    }
    if (method === "POST" && action === "payment-session") {
      if (auth.u.id !== o.owner)
        throw fail(403, "إنشاء جلسة الدفع متاح لصاحب الطلب فقط.");
      rate(`edfapay-checkout:${auth.u.id}`, 10, 60000);
      const providerOrderId = `${o.number}-${id().slice(0, 12)}`;
      const checkoutInput = await jsonBody(req);
      const session = await edfapayCheckout.initiate({ order: o, providerOrderId, billing: checkoutInput.billing, payerIp: ip });
      await db.insert("edfapayAttempt", {
        id: digest(providerOrderId),
        providerOrderId,
        orderId: o.id,
        orderNumber: o.number,
        amount: o.amount,
        currency: "SAR",
        createdAt: now(),
      }, o.owner);
      await db.update("order", oid, (x) => {
        if (x.status !== "awaiting_payment" || x.amount !== o.amount || x.currentContract !== o.currentContract)
          throw fail(409, "تغيّر الطلب قبل بدء الدفع؛ حدّث الصفحة وحاول مجددًا.");
        event(x, "تم إنشاء جلسة دفع إلكتروني عبر مبسط", auth.u);
        return x;
      });
      return json(res, 201, { redirectUrl: session.redirectUrl });
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
          subtotal: x.subtotal ?? x.amount,
          discount: x.discount || 0,
          promotion: x.promotion || null,
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
      notifyOrderSms(result, "تم تأكيد استلام الدفع.");
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
    if (method === "POST" && action === "study-ready") {
      authorize(auth, true);
      const b = await jsonBody(req);
      if (!o.study || b.reviewed !== true) throw fail(400, "أكد مراجعة اكتمال بيانات الدراسة.");
      const result = await db.update("order", oid, x => {
        if (!x.study.documents || !["received", "reviewing", "quoted", "awaiting_payment", "paid"].includes(x.status)) throw fail(409, "تتم مراجعة البيانات بعد توثيق المستندات وقبل بدء التنفيذ.");
        x.study.inputsReviewed = { at: now(), by: auth.u.id };
        event(x, "أكد الفريق اكتمال بيانات دراسة الجدوى أو اعتماد الافتراضات مع العميل", auth.u);
        return x;
      });
      return json(res, 200, safeOrder(result));
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
        if (x.study && b.status === "in_progress" && !x.study.inputsReviewed)
          throw fail(409, "تحقق من اكتمال بيانات الدراسة واعتماد الافتراضات مع العميل قبل بدء التنفيذ.");
        if (!(transitions[x.status] || []).includes(b.status))
          throw fail(409, "هذا الانتقال غير متاح في المرحلة الحالية.");
        x.status = b.status;
        event(x, text(b.note || "تم تحديث مرحلة المشروع", 2, 1000), auth.u);
        return x;
      });
      notifyOrderSms(result, orderStatusLabels[result.status] || "تم تحديث حالة طلبك.");
      return json(res, 200, result);
    }
    throw fail(404, "المسار غير موجود.");
  }
  if (path.startsWith("/api/admin/")) {
    authorize(auth, true);
    if (method === "GET" && path === "/api/admin/contract-provider")
      return json(res, 200, {
        legalName: process.env.BUSINESS_LEGAL_NAME || "",
        address: process.env.BUSINESS_ADDRESS || "",
        registrationNumber: process.env.BUSINESS_REGISTRATION_NUMBER || "",
        registrationType: ["none", "commercial_registration", "freelance_certificate"].includes(process.env.BUSINESS_REGISTRATION_TYPE)
          ? process.env.BUSINESS_REGISTRATION_TYPE : "none",
        activity: process.env.BUSINESS_ACTIVITY || "",
      });
    if (method === "GET" && path === "/api/admin/dashboard")
      return json(res, 200, operationalDashboard(await db.list("order")));
    if (method === "GET" && path === "/api/admin/channels")
      return json(res, 200, {
        email: { ready: recovery.readiness.emailReady },
        whatsapp: { ready: recovery.readiness.whatsappReady, direct: true, provider: recovery.readiness.whatsappReady ? "twilio" : null },
        sms: { configured: smsReady },
        meta: metaWebhook.readiness,
        edfapay: {
          ...edfapayWebhook.readiness,
          callbackUrl: edfapayWebhook.callbackUrl,
          checkout: edfapayCheckout.readiness,
        },
        assistant: { mode: process.env.ASSISTANT_MODE === "openai" ? "openai" : "guided" },
        payment: edfapayCheckout.readiness.configured ? "edfapay_and_bank_transfer" : "bank_transfer",
      });
    if (method === "GET" && path === "/api/admin/payments/notifications") {
      const attempts = new Map((await db.list("edfapayAttempt")).map((attempt) => [attempt.providerOrderId, attempt]));
      return json(res, 200, (await db.list("edfapayReceipt"))
        .sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 50)
        .map((receipt) => {
          const attempt = attempts.get(receipt.orderNumber);
          return {
            ...receipt,
            matchedOrderId: attempt?.orderId || null,
            expectedAmount: attempt?.amount || null,
            expectedCurrency: attempt?.currency || null,
          };
        }));
    }
    if (method === "GET" && path === "/api/admin/summary") {
      const orders = await db.list("order"),
        users = await db.list("user"),
        tickets = await db.list("ticket");
      return json(res, 200, {
        orders: orders.length,
        active: orders.filter(
          (o) => !["completed", "cancelled"].includes(o.status),
        ).length,
        customers: new Set(users.filter((u) => u.role === "customer").map((u) => String(u.email || u.id).toLowerCase())).size,
        contracts: orders.filter((o) => o.currentContract).length,
        awaitingPayment: orders.filter((o) => o.status === "awaiting_payment").length,
        paidOrders: orders.filter((o) => o.payment?.confirmed && !o.payment.revoked).length,
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
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
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
    `default-src 'self'; script-src 'self'${ga4MeasurementId ? " https://www.googletagmanager.com" : ""}; style-src 'self'; img-src 'self' data:${ga4MeasurementId ? " https://www.google-analytics.com https://region1.google-analytics.com" : ""}; connect-src 'self'${ga4MeasurementId ? " https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com" : ""}; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
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
      pathname === "/" ? "index.html" : "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname),
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
