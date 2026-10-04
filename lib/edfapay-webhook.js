import { timingSafeEqual } from 'node:crypto';
import { body, digest, fail } from './security.js';

export const edfapayCallbackPath = '/api/webhooks/edfapay';
const maxBytes = 64 * 1024;
function equal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function parse(req) {
  const contentType = String(req.headers['content-type'] || '');
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (!['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'].includes(type))
    throw fail(415, 'صيغة إشعار الدفع غير مدعومة.');
  const raw = await body(req, maxBytes);
  try {
    let entries;
    if (type === 'application/json') {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
      entries = Object.entries(value);
    } else if (type === 'application/x-www-form-urlencoded') {
      entries = [...new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(raw))];
    } else {
      entries = [...await new Response(raw, { headers: { 'Content-Type': contentType } }).formData()];
    }
    if (entries.length > 40) throw Error();
    const data = Object.create(null);
    for (const [key, value] of entries) {
      if (key.length > 64 || Object.hasOwn(data, key) || typeof value !== 'string' || value.length > 2048)
        throw Error();
      data[key] = value;
    }
    return data;
  } catch { throw fail(400, 'إشعار الدفع غير صالح.'); }
}

// Receipt preparation only. Never changes orders, invoices or download entitlement.
// The legacy public docs do not specify a complete authenticated card callback contract.
// The private URL token controls access but does not prove settlement or bind signed status.
export function createEdfapayWebhook({ db, env = process.env, origin, clock = Date.now }) {
  const token = env.EDFAPAY_CALLBACK_TOKEN || '';
  const enabled = env.EDFAPAY_WEBHOOK_ENABLED === 'true';
  const configured = enabled && /^[A-Za-z0-9_-]{32,128}$/.test(token);
  const publicOrigin = origin || new URL(env.APP_URL || 'http://localhost').origin;
  const readiness = Object.freeze({ configured, checkoutEnabled: false, autoConfirmation: false });
  const callbackUrl = configured ? publicOrigin + edfapayCallbackPath + '?token=' + encodeURIComponent(token) : null;
  let tail = Promise.resolve();
  async function receive(req, params) {
    if (!configured) throw fail(503, 'استقبال إشعارات مبسط يحتاج إعدادات الخادم.');
    if (params.getAll('token').length !== 1 || !equal(params.get('token') || '', token))
      throw fail(403, 'تعذر التحقق من رابط الإشعار.');
    const data = await parse(req);
    // Preserve only bounded reconciliation identifiers. Never store raw callbacks,
    // card numbers, tokens, passwords, customer details or the private URL token.
    const pick = (first, second, pattern, max = 255) => {
      if (data[first] !== undefined && data[second] !== undefined && data[first] !== data[second])
        throw fail(400, 'حقول إشعار الدفع متعارضة.');
      const value = (data[first] ?? data[second] ?? '').trim();
      if (!value || value.length > max || !pattern.test(value)) throw fail(400, 'حقول إشعار الدفع غير صالحة.');
      return value;
    };
    const orderNumber = pick('order_id', 'order_number', /^[A-Za-z0-9_.:-]+$/);
    const transactionId = pick('trans_id', 'id', /^[A-Za-z0-9_.:-]+$/);
    const reportedAmount = pick('amount', 'order_amount', /^\d{1,10}(?:\.\d{1,2})?$/, 13);
    const currency = pick('currency', 'order_currency', /^[A-Z]{3}$/, 3);
    const status = pick('status', 'status', /^[A-Za-z0-9_ -]+$/, 32).toUpperCase();
    const action = pick('action', 'type', /^[A-Za-z0-9_ -]+$/, 32).toUpperCase();
    const result = String(data.result || '').trim().toUpperCase();
    if (result.length > 32 || (result && !/^[A-Z0-9_ -]+$/.test(result))) throw fail(400, 'نتيجة إشعار الدفع غير صالحة.');
    const receipt = { orderNumber, transactionId, reportedAmount, currency, status, action, result,
      verified: false, requiresReview: true };
    receipt.id = digest(JSON.stringify(receipt));
    receipt.receivedAt = clock();
    const job = tail.then(async () => {
      if (await db.get('edfapayReceipt', receipt.id)) return;
      try { await db.insert('edfapayReceipt', receipt, ''); }
      catch (error) {
        // Concurrent delivery to separate workers uses the database's unique key.
        if (error.code !== 'ER_DUP_ENTRY' && !String(error.message).includes('UNIQUE constraint')) throw error;
      }
      const receipts = (await db.list('edfapayReceipt')).sort((a, b) => b.receivedAt - a.receivedAt);
      for (let i = 0; i < receipts.length; i++)
        if (i >= 500 || receipts[i].receivedAt < clock() - 30 * 86400000)
          await db.remove('edfapayReceipt', receipts[i].id);
    });
    tail = job.catch(() => {});
    await job;
    return 'OK';
  }
  return { readiness, callbackUrl, receive };
}
