import { digest } from './security.js';
import { createGuidedAssistant, normalizeArabic } from './guided-assistant.js';

// Replies use the public catalog only; no AI credentials or private order access.
export function createWhatsappReplies({ db, getCatalog, env = process.env, clock = Date.now, fetchImpl = fetch }) {
  let origin;
  try { const u = new URL(env.APP_URL); if (u.protocol === 'https:' && !u.username && !u.password) origin = u.origin; } catch {}
  const configured = env.META_AUTOREPLY_ENABLED === 'true' && !!origin &&
    /^[0-9]{8,24}$/.test(env.META_WHATSAPP_PHONE_NUMBER_ID || '') &&
    /^[A-Za-z0-9_-]{20,4096}$/.test(env.META_WHATSAPP_ACCESS_TOKEN || '') &&
    /^v\d{2}\.0$/.test(env.META_GRAPH_API_VERSION || '');
  const assistant = createGuidedAssistant({ getCatalog, timeoutMs: 2000 });
  const readiness = Object.freeze({ configured: !!configured });
  let tail = Promise.resolve();
  async function processMessage(message) {
    if (!configured || message?.type !== 'text' || !/^\d{8,15}$/.test(message.from || '') ||
      typeof message.id !== 'string' || !message.id.length || message.id.length > 256 ||
      typeof message.text?.body !== 'string' || !message.text.body.trim() || message.text.body.length > 3000 ||
      !/^\d{10,12}$/.test(String(message.timestamp))) return;
    const age = clock() - Number(message.timestamp) * 1000;
    // Never reply to historical/replayed messages or outside the service window.
    if (age < -60000 || age > 5 * 60000) return;
    const id = digest(env.META_WHATSAPP_PHONE_NUMBER_ID + ':' + message.id);
    if (await db.get('whatsappReply', id)) return;
    const owner = digest(message.from);
    const recent = await db.list('whatsappReply', owner);
    if (recent.filter(item => item.at > clock() - 60000).length >= 5) return;
    const text = normalizeArabic(message.text.body);
    let reply;
    if (/^(?:مرحبا|مرحبا بكم|السلام عليكم|هلا|اهلا|hello|hi|القائمه|0|٠)[!؟?. ]*$/.test(text)) {
      reply = 'أهلًا بك في انطلاقة 👋\nأنا المساعد الآلي للخدمات والأسعار المنشورة.\nاكتب اسم الخدمة أو سؤالك، مثل: تصميم متجر، موقع، هوية أو دراسة جدوى.\nللتواصل مع الفريق اكتب: موظف.\nالخدمات: ' + origin + '/#/services';
    } else if (/موظف|بشري|خدمه العملاء/.test(text)) {
      reply = 'للتواصل مع فريق انطلاقة افتح صفحة الدعم:\n' + origin + '/#/support\nهذه رسالة آلية، ولم يُنشأ طلب دعم أو يُحوّل الحوار إلى موظف تلقائيًا.';
    } else {
      const result = await assistant.reply([{ role: 'user', content: message.text.body }]);
      const links = (result.links || []).filter(link => /^#\//.test(link.href) || /^\/demos\//.test(link.href));
      reply = result.reply.slice(0, 3200) + (links.length ? '\n\n' + links.slice(0, 3).map(link => link.label + ': ' + origin + '/' + link.href.replace(/^\//, '')).join('\n') : '');
    }
    const record = { id, at: clock(), state: 'attempted' };
    // Claim before sending. A timeout has unknown delivery status: never resend automatically.
    try { await db.insert('whatsappReply', record, owner); }
    catch (error) { if (await db.get('whatsappReply', id)) return; throw error; }
    try {
      const response = await fetchImpl(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
        headers: { Authorization: 'Bearer ' + env.META_WHATSAPP_ACCESS_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: message.from, type: 'text',
          context: { message_id: message.id }, text: { preview_url: false, body: reply.slice(0, 4096) } }),
      });
      record.state = response.ok ? 'accepted' : 'failed';
      await response.body?.cancel();
    } catch { record.state = 'unknown'; }
    await db.update('whatsappReply', id, () => record);
    for (const old of recent) if (old.at < clock() - 7 * 86400000) await db.remove('whatsappReply', old.id);
  }
  return { readiness, receive(message) {
    const job = tail.then(() => processMessage(message));
    tail = job.catch(() => {});
    return job;
  } };
}
