import { createHmac, timingSafeEqual } from 'node:crypto';
import { body, digest, fail } from './security.js';

function equal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Separate opt-in: no token grants, outbound messages or phone registration here.
export function createMetaWebhook({ db, env = process.env, clock = Date.now }) {
  const ready = env.META_WEBHOOK_ENABLED === 'true' &&
    /^[a-f0-9]{32}$/i.test(env.META_APP_SECRET || '') &&
    /^[0-9]{8,24}$/.test(env.META_WHATSAPP_ACCOUNT_ID || '') &&
    /^[0-9]{8,24}$/.test(env.META_WHATSAPP_PHONE_NUMBER_ID || '') &&
    /^[A-Za-z0-9_-]{32,128}$/.test(env.META_WEBHOOK_VERIFY_TOKEN || '');
  const readiness = Object.freeze({ configured: !!ready, outbound: false });
  function challenge(params) {
    if (!ready) throw fail(503, 'ربط إشعارات Meta غير مفعّل.');
    const value = params.get('hub.challenge');
    if (params.get('hub.mode') !== 'subscribe' ||
      !equal(params.get('hub.verify_token') || '', env.META_WEBHOOK_VERIFY_TOKEN) ||
      !/^\d{1,128}$/.test(value || '')) throw fail(403, 'تعذر التحقق من الاشتراك.');
    return value;
  }
  let tail = Promise.resolve();
  async function receive(req) {
    if (!ready) throw fail(503, 'ربط إشعارات Meta غير مفعّل.');
    if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json')
      throw fail(415, 'صيغة الإشعار غير مدعومة.');
    const raw = await body(req, 200000);
    const signature = req.headers['x-hub-signature-256'];
    if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature) ||
      !equal(signature, 'sha256=' + createHmac('sha256', env.META_APP_SECRET).update(raw).digest('hex')))
      throw fail(403, 'توقيع الإشعار غير صالح.');
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { throw fail(400, 'الإشعار غير صالح.'); }
    if (payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry))
      throw fail(400, 'الإشعار غير صالح.');
    const events = [];
    for (const entry of payload.entry) {
      if (entry.id !== env.META_WHATSAPP_ACCOUNT_ID || !Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        const v = change.value;
        if (change.field !== 'messages' || v?.metadata?.phone_number_id !== env.META_WHATSAPP_PHONE_NUMBER_ID) continue;
        for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
          if (typeof s.id !== 'string' || s.id.length > 256 || !['sent','delivered','read','failed'].includes(s.status) ||
            !/^\d{10,12}$/.test(String(s.timestamp))) continue;
          // Persist only delivery receipts. Never retain message bodies or customer phone numbers.
          events.push({ id: digest(s.id + ':' + s.status + ':' + s.timestamp),
            messageId: s.id, status: s.status, at: Number(s.timestamp) * 1000,
            receivedAt: clock() });
        }
      }
    }
    if (events.length > 1000) throw fail(413, 'عدد الإشعارات أكبر من المسموح.');
    const job = tail.then(async () => {
      for (const event of events) {
        if (await db.get('metaReceipt', event.id)) continue;
        await db.insert('metaReceipt', event, '');
      }
      for (const old of await db.list('metaReceipt'))
        if (old.receivedAt < clock() - 30 * 86400000) await db.remove('metaReceipt', old.id);
    });
    tail = job.catch(() => {});
    await job;
    return { ok: true };
  }
  return { readiness, challenge, receive };
}
