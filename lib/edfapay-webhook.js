import { createHmac, timingSafeEqual } from "node:crypto";
import { body, digest, fail } from "./security.js";

export const edfapayCallbackPath = "/api/webhooks/edfapay";
const maxBytes = 64 * 1024;

function equal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function clean(value, pattern, max = 255, required = true) {
  const result = String(value ?? "").trim();
  if ((!result && required) || result.length > max || (result && !pattern.test(result)))
    throw fail(400, "حقول إشعار الدفع غير صالحة.");
  return result;
}

function parseJson(raw) {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    if (Object.keys(value).length > 40) throw Error();
    return value;
  } catch {
    throw fail(400, "إشعار الدفع غير صالح.");
  }
}

async function parseLegacy(req) {
  const contentType = String(req.headers["content-type"] || "");
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!["application/json", "application/x-www-form-urlencoded", "multipart/form-data"].includes(type))
    throw fail(415, "صيغة إشعار الدفع غير مدعومة.");
  const raw = await body(req, maxBytes);
  try {
    let entries;
    if (type === "application/json") entries = Object.entries(parseJson(raw));
    else if (type === "application/x-www-form-urlencoded")
      entries = [...new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(raw))];
    else
      entries = [...await new Response(raw, { headers: { "Content-Type": contentType } }).formData()];
    if (entries.length > 40) throw Error();
    const data = Object.create(null);
    for (const [key, value] of entries) {
      if (key.length > 64 || Object.hasOwn(data, key) || typeof value !== "string" || value.length > 2048)
        throw Error();
      data[key] = value;
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw fail(400, "إشعار الدفع غير صالح.");
  }
}

function legacyReceipt(data) {
  const pick = (first, second, pattern, max = 255) => {
    if (data[first] !== undefined && data[second] !== undefined && data[first] !== data[second])
      throw fail(400, "حقول إشعار الدفع متعارضة.");
    return clean(data[first] ?? data[second], pattern, max);
  };
  const orderNumber = pick("order_id", "order_number", /^[A-Za-z0-9_.:-]+$/);
  const transactionId = pick("trans_id", "id", /^[A-Za-z0-9_.:-]+$/);
  const reportedAmount = pick("amount", "order_amount", /^\d{1,10}(?:\.\d{1,2})?$/, 13);
  const currency = pick("currency", "order_currency", /^[A-Z]{3}$/, 3);
  const status = pick("status", "status", /^[A-Za-z0-9_ -]+$/, 32).toUpperCase();
  const action = pick("action", "type", /^[A-Za-z0-9_ -]+$/, 32).toUpperCase();
  const result = clean(data.result, /^[A-Za-z0-9_ -]+$/, 32, false).toUpperCase();
  return { orderNumber, transactionId, reportedAmount, currency, status, action, result, verified:false, requiresReview:true, source:"legacy" };
}

function signedReceipt(data) {
  const amountValue = typeof data.amount === "number" ? String(data.amount) : data.amount;
  const receipt = {
    orderNumber: clean(data.orderId, /^[A-Za-z0-9_.:-]+$/),
    transactionId: clean(data.transactionId, /^[A-Za-z0-9_.:-]+$/),
    reportedAmount: clean(amountValue, /^\d{1,10}(?:\.\d{1,3})?$/, 14),
    currencyCode: clean(data.currencyCode, /^\d{3}$/, 3),
    status: clean(data.status, /^[A-Za-z0-9_ -]+$/, 32).toUpperCase(),
    action: clean(data.type, /^[A-Za-z0-9_ -]+$/, 32).toUpperCase(),
    merchantId: clean(data.merchantId, /^[A-Za-z0-9_.:-]+$/, 255),
    rrn: clean(data.rrn, /^[A-Za-z0-9_.:-]+$/, 64, false),
    verified: true,
    requiresReview: true,
    source: "signed",
  };
  return receipt;
}

export function createEdfapayWebhook({ db, env = process.env, origin, clock = Date.now }) {
  const token = String(env.EDFAPAY_CALLBACK_TOKEN || "");
  const secret = String(env.EDFAPAY_WEBHOOK_SECRET || "");
  const enabled = env.EDFAPAY_WEBHOOK_ENABLED === "true";
  const signed = enabled && secret.length >= 32;
  const legacy = enabled && !signed && /^[A-Za-z0-9_-]{32,128}$/.test(token);
  const configured = signed || legacy;
  const publicOrigin = origin || new URL(env.APP_URL || "http://localhost").origin;
  const readiness = Object.freeze({ configured, signed, legacy, checkoutEnabled:false, autoConfirmation:false });
  const callbackUrl = configured
    ? publicOrigin + edfapayCallbackPath + (legacy ? "?token=" + encodeURIComponent(token) : "")
    : null;
  let tail = Promise.resolve();

  async function receive(req, params) {
    if (!configured) throw fail(503, "استقبال إشعارات مبسط يحتاج إعدادات الخادم.");
    let receipt;
    if (signed) {
      const raw = await body(req, maxBytes);
      const signature = String(req.headers["x-edfapay-signature"] || "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(signature)) throw fail(403, "تعذر التحقق من توقيع إشعار الدفع.");
      const expected = createHmac("sha256", secret).update(raw).digest("hex");
      if (!equal(signature, expected)) throw fail(403, "تعذر التحقق من توقيع إشعار الدفع.");
      receipt = signedReceipt(parseJson(raw));
    } else {
      if (params.getAll("token").length !== 1 || !equal(params.get("token") || "", token))
        throw fail(403, "تعذر التحقق من رابط الإشعار.");
      receipt = legacyReceipt(await parseLegacy(req));
    }

    receipt.id = digest(JSON.stringify(receipt));
    receipt.receivedAt = clock();
    const job = tail.then(async () => {
      if (await db.get("edfapayReceipt", receipt.id)) return;
      try { await db.insert("edfapayReceipt", receipt, ""); }
      catch (error) {
        if (error.code !== "ER_DUP_ENTRY" && !String(error.message).includes("UNIQUE constraint")) throw error;
      }
      const receipts = (await db.list("edfapayReceipt")).sort((a, b) => b.receivedAt - a.receivedAt);
      for (let i = 0; i < receipts.length; i++)
        if (i >= 500 || receipts[i].receivedAt < clock() - 30 * 86400000)
          await db.remove("edfapayReceipt", receipts[i].id);
    });
    tail = job.catch(() => {});
    await job;
    return "OK";
  }
  return { readiness, callbackUrl, receive };
}
