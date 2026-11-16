import { id, digest, fail, text, phone as normalizePhone } from './security.js';

export const accessPolicyVersion = '2026-11-15';
const invalid = () => fail(400, 'رمز التحقق غير صحيح أو منتهي. اطلب رمزًا جديدًا عند الحاجة.');
const duplicate = error => error.code === 'ER_DUP_ENTRY' || String(error.message).includes('UNIQUE constraint');

export function hasServiceAccess(auth) {
  return !!auth && (auth.u.role === 'admin' ||
    (auth.u.role === 'customer' && auth.u.phoneVerified === true &&
      !!auth.u.phone && typeof auth.u.name === 'string' && auth.u.name.trim().length >= 2 &&
      auth.s.authentication === 'phone_otp' && auth.u.accessPolicyVersion === accessPolicyVersion));
}

export function createPhoneLogin({ db, env = process.env, request = fetch, clock = Date.now }) {
  const key = String(env.AUTHENTICA_API_KEY || '').trim();
  const configured = key.length >= 16 && !/[\r\n]/.test(key);
  const readiness = Object.freeze({ ready: configured, provider: 'authentica', channel: 'sms', policyVersion: accessPolicyVersion });
  async function provider(path, payload) {
    if (!configured) throw fail(503, 'تسجيل الدخول بالجوال غير متاح حاليًا. تواصل مع فريق انطلاقة.');
    let response, data;
    try {
      response = await request('https://api.authentica.sa/api/v2/' + path, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Authorization': key },
        body: JSON.stringify(payload),
      });
      data = await response.json();
    } catch { throw fail(503, 'تعذر الاتصال بخدمة التحقق. حاول مجددًا بعد قليل.'); }
    if (response.status === 429) throw fail(429, 'طلبات تحقق كثيرة. انتظر قليلًا قبل المحاولة.');
    if ([401, 403].includes(response.status)) throw fail(503, 'خدمة التحقق تحتاج مراجعة إعدادات الربط. تواصل مع الدعم.');
    if (!response.ok || !data || typeof data !== 'object' || data.success === false ||
        (path === 'send-otp' && data.success !== true))
      throw path === 'verify-otp' ? invalid() : fail(503, 'تعذر إرسال رمز التحقق. تحقق من الرقم وحاول لاحقًا.');
    return data;
  }
  async function send(input) {
    if (!configured) throw fail(503, 'تسجيل الدخول بالجوال غير متاح حاليًا. تواصل مع فريق انطلاقة.');
    const name = text(input.name, 2, 100), phone = normalizePhone(input.phone);
    if (/[\x00-\x1f\x7f]/.test(name)) throw fail(400, 'أدخل اسمًا صحيحًا.');
    if (!/^\+9665\d{8}$/.test(phone)) throw fail(400, 'أدخل رقم جوال سعوديًا صحيحًا.');
    if (input.acceptTerms !== true) throw fail(400, 'يلزم الموافقة على سياسة الاستخدام والخصوصية.');
    const at = clock(), phoneKey = digest(phone), challengeId = id();
    const reserve = current => {
      if (at - current.lastSent < 60000) throw fail(429, 'انتظر دقيقة قبل طلب رمز جديد.');
      const count = at - current.windowStart < 15 * 60000 ? current.count : 0;
      if (count >= 3) throw fail(429, 'بلغت حد رسائل التحقق. حاول بعد ربع ساعة.');
      return { id: phoneKey, challengeId, lastSent: at, windowStart: count ? current.windowStart : at, count: count + 1 };
    };
    const previous = await db.get('mobileIndex', phoneKey);
    try {
      if (previous) await db.update('mobileIndex', phoneKey, reserve);
      else await db.insert('mobileIndex', { id: phoneKey, challengeId, lastSent: at, windowStart: at, count: 1 });
    } catch (error) { if (duplicate(error)) throw fail(429, 'يوجد طلب تحقق جارٍ لهذا الرقم. انتظر قليلًا.'); throw error; }
    await db.insert('mobileChallenge', { id: challengeId, name, phone, phoneKey, createdAt: at,
      expires: at + 5 * 60000, attempts: 0, used: false, sent: false, verifying: false,
      policyVersion: accessPolicyVersion });
    await provider('send-otp', { method: 'sms', phone });
    await db.update('mobileChallenge', challengeId, c => { c.sent = true; return c; });
    return { challengeId, expiresIn: 300, resendAfter: 60,
      phoneHint: phone.slice(0, 4) + '•••••' + phone.slice(-3), message: 'أرسلنا رمز التحقق إلى جوالك. أدخله لإتمام تسجيل الدخول.' };
  }
  async function check(input) {
    const challengeId = text(input.challengeId, 36, 36), code = text(input.code, 4, 10);
    if (!/^[a-f0-9]{36}$/.test(challengeId) || !/^\d{4,10}$/.test(code)) throw invalid();
    const c = await db.get('mobileChallenge', challengeId);
    const usable = value => value && value.sent && !value.used && !value.verifying && value.expires > clock() && value.attempts < 5;
    const index = c && await db.get('mobileIndex', c.phoneKey);
    if (!usable(c) || index?.challengeId !== challengeId) throw invalid();
    await db.update('mobileChallenge', challengeId, value => {
      if (!usable(value)) throw invalid(); value.attempts++; value.verifying = true; return value;
    });
    try {
      const result = await provider('verify-otp', { phone: c.phone, otp: code });
      // Authentica v2 documents boolean status=true for verification (send-otp uses success=true).
      // A successful HTTP request, a string "true", or a generic send success is not verification.
      if (result.status === false || result.verified === false || result.data?.verified === false ||
          !(result.status === true || result.verified === true || result.data?.verified === true ||
          result.status === 'verified' || result.data?.status === 'verified')) throw invalid();
      const mapping = await db.get('verifiedPhone', c.phoneKey);
      let user = mapping && await db.get('user', mapping.userId);
      if (mapping && (!user || user.disabled || user.role !== 'customer' || !user.phoneVerified || user.phone !== c.phone))
        throw fail(409, 'تعذر ربط الرقم بهذا الحساب. تواصل مع الدعم.');
      const claim = await db.get('loginPhone', c.phoneKey);
      const uid = user?.id || digest('customer-phone:' + c.phone);
      if (claim && claim.userId !== uid) throw fail(409, 'للرقم ارتباط بحساب سابق يحتاج مراجعة الدعم.');
      const updateUser = value => {
        if (value.disabled || value.role !== 'customer' || value.phone !== c.phone || !value.phoneVerified)
          throw fail(409, 'تغيّر الحساب. أعد تسجيل الدخول.');
        value.name = c.name; value.accessPolicyVersion = c.policyVersion;
        value.termsAcceptedAt = new Date(clock()).toISOString(); return value;
      };
      const inserts = [];
      if (!user) {
        user = { id: uid, name: c.name, email: '', phone: c.phone, loginPhone: c.phone,
          phoneVerified: true, role: 'customer', authVersion: 0, passwordVersion: 0,
          accessPolicyVersion: c.policyVersion, termsAcceptedAt: new Date(clock()).toISOString(),
          createdAt: new Date(clock()).toISOString() };
        inserts.push({ kind: 'user', item: user, owner: uid },
          { kind: 'verifiedPhone', item: { id: c.phoneKey, userId: uid }, owner: uid });
      }
      if (!claim) inserts.push({ kind: 'loginPhone', item: { id: c.phoneKey, userId: uid }, owner: uid });
      const values = await db.updateMany([
        { kind: 'mobileIndex', id: c.phoneKey, fn: value => {
          if (value.challengeId !== challengeId) throw invalid(); return value;
        } },
        { kind: 'mobileChallenge', id: challengeId, fn: value => {
          if (value.used || value.expires <= clock() || !value.verifying) throw invalid();
          value.used = true; value.verifying = false; return value;
        } },
        ...(mapping ? [{ kind: 'user', id: uid, fn: updateUser }] : []),
      ], inserts);
      return mapping ? values[2] : user;
    } catch (error) {
      await db.update('mobileChallenge', challengeId, value => { value.verifying = false; return value; });
      if (duplicate(error)) throw fail(409, 'تغيّر ارتباط الرقم أثناء التحقق. اطلب رمزًا جديدًا.');
      throw error;
    }
  }
  return { readiness, send, check };
}
