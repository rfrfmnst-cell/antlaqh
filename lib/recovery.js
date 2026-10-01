import { randomBytes } from "node:crypto";
import { id, digest, fail, email, phone, password, hashPassword } from "./security.js";

const genericMessage = "إذا كانت البيانات مرتبطة بحساب مؤهل، ستصلك تعليمات الاستعادة. إن لم تصل، انتظر قليلًا ثم حاول مجددًا أو تواصل مع الدعم.";
const invalidCode = () => fail(400, "الرمز غير صالح أو منتهي. اطلب رمزًا جديدًا أو حاول لاحقًا.");
const invalidToken = () => fail(400, "رابط الاستعادة غير صالح أو منتهي. اطلب استعادة جديدة.");

export async function createRecovery({ db, env = process.env, clock = () => Date.now(), transport, fetchImpl = globalThis.fetch }) {
  const twilioConfig = { account: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, service: env.TWILIO_VERIFY_SERVICE_SID };
  const twilioUrl = `https://verify.twilio.com/v2/Services/${encodeURIComponent(twilioConfig.service || "")}`;
  const twilioHeaders = { Authorization: `Basic ${Buffer.from(`${twilioConfig.account}:${twilioConfig.token}`).toString("base64")}` };
  let appUrl;
  try { const value = new URL(env.APP_URL); if (value.protocol === "https:" && !value.username && !value.password) appUrl = value.origin; } catch {}
  const smtpPort = Number(env.SMTP_PORT || 587);
  const smtpSecure = env.SMTP_SECURE === "true";
  let from;
  try { from = email(env.RECOVERY_FROM_EMAIL); } catch {}
  const smtpConfigured = env.RECOVERY_EMAIL_ENABLED === "true" && appUrl && from &&
    env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD &&
    Number.isInteger(smtpPort) && smtpPort >= 1 && smtpPort <= 65535 &&
    (smtpPort !== 465 || smtpSecure);
  let emailReady = false;
  if (smtpConfigured) {
    try {
      if (!transport) {
        const nodemailer = await import("nodemailer");
        transport = nodemailer.default.createTransport({
          host: env.SMTP_HOST, port: smtpPort, secure: smtpSecure,
          requireTLS: !smtpSecure, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
          tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
          connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000, dnsTimeout: 8000,
        });
      }
      let timer;
      try { await Promise.race([transport.verify(), new Promise((_, reject) => {
        timer = setTimeout(() => { transport.close?.(); reject(new Error("SMTP verification timeout")); }, 12000);
      })]); } finally { clearTimeout(timer); }
      emailReady = true;
    } catch { emailReady = false; }
  }
  let whatsappReady = false;
  if (env.RECOVERY_WHATSAPP_ENABLED === "true" && /^AC[a-f0-9]{32}$/i.test(twilioConfig.account || "") &&
      twilioConfig.token && /^VA[a-f0-9]{32}$/i.test(twilioConfig.service || "")) {
    try {
      const response = await fetchImpl(twilioUrl, { method: "GET", headers: twilioHeaders, signal: AbortSignal.timeout(10000) });
      if (response.ok) whatsappReady = /^MG[a-f0-9]{32}$/i.test((await response.json()).whatsapp?.msg_service_sid || "");
    } catch {}
  }
  const readiness = Object.freeze({ emailReady: !!emailReady, whatsappReady: !!whatsappReady });
  const deliveries = new Set();
  const requestLimits = new Map();
  let lastCleanup = 0;
  async function pruneExpired() {
    const current = clock();
    if (current - lastCleanup < 60000) return;
    lastCleanup = current;
    for (const kind of ["recoveryToken", "recoveryChallenge"])
      for (const record of await db.list(kind)) if (record.expires <= current) await db.remove(kind, record.id);
  }
  function throttle(identifier) {
    const current = clock(), key = digest(identifier);
    for (const [stored, value] of requestLimits) if (value.until <= current) requestLimits.delete(stored);
    const value = requestLimits.get(key) || { count: 0, until: current + 15 * 60 * 1000 };
    if (++value.count > 3) throw fail(429, "محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.");
    requestLimits.set(key, value);
  }
  function queueDelivery(task, kind, key) {
    // Return the same response before delivery, so SMTP/network timing cannot reveal account existence.
    const job = Promise.resolve().then(task).catch(async () => {
      try { await db.remove(kind, key); } catch {}
    });
    deliveries.add(job);
    void job.then(() => deliveries.delete(job));
  }
  async function verifyRequest(path, data) {
    const response = await fetchImpl(`${twilioUrl}/${path}`, {
      method: "POST", headers: {
        ...twilioHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
      }, body: new URLSearchParams(data), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw invalidCode();
    return response.json();
  }
  function tokenFor(user, channel, identifier) {
    const raw = randomBytes(32).toString("hex");
    return { raw, record: {
      id: digest(raw), purpose: "recovery", userId: user?.id || null, channel,
      identifier, expires: clock() + 30 * 60 * 1000, used: false,
      authVersion: user?.authVersion || 0, passwordVersion: user?.passwordVersion || 0,
    } };
  }
  function currentUser(user, record) {
    if (!user || user.disabled || (user.authVersion || 0) !== record.authVersion ||
        (user.passwordVersion || 0) !== record.passwordVersion) return false;
    return record.channel === "email" ? user.email === record.identifier
      : user.phoneVerified && user.phone === record.identifier;
  }
  function checkChannel(channel) {
    if (!["email", "whatsapp"].includes(channel)) throw fail(400, "اختر وسيلة الاستعادة الصحيحة.");
    if (!readiness[channel === "email" ? "emailReady" : "whatsappReady"])
      throw fail(503, "الاستعادة بهذه الوسيلة غير مفعّلة حاليًا. تواصل مع الدعم.");
  }
  async function request({ channel, identifier }) {
    checkChannel(channel);
    const normalized = channel === "email" ? email(identifier) : phone(identifier);
    throttle(`${channel}:${normalized}`);
    await pruneExpired();
    const challengeId = id();
    let user;
    if (channel === "email") user = await db.get("user", digest(normalized));
    else {
      const mapping = await db.get("verifiedPhone", digest(normalized));
      user = mapping ? await db.get("user", mapping.userId) : null;
      if (!user?.phoneVerified || user.phone !== normalized) user = null;
    }
    if (user?.disabled) user = null;
    if (channel === "email") {
      const token = tokenFor(user, channel, normalized);
      await db.insert("recoveryToken", token.record, user?.id || "");
      if (user) {
        const resetUrl = new URL("/", appUrl);
        resetUrl.hash = `/reset-password?token=${token.raw}`;
        queueDelivery(() => transport.sendMail({ from, to: user.email,
          subject: "استعادة كلمة مرور انطلاقة",
          text: `طلبت استعادة كلمة مرور حسابك في انطلاقة. افتح الرابط التالي خلال 30 دقيقة:\n${resetUrl.href}\n\nإذا لم تطلب الاستعادة، يمكنك تجاهل هذه الرسالة.`,
          disableFileAccess: true, disableUrlAccess: true,
        }), "recoveryToken", token.record.id);
      }
    } else {
      const challenge = { id: challengeId, purpose: "recovery", channel, phone: normalized,
        userId: user?.id || null, expires: clock() + 10 * 60 * 1000, attempts: 0, used: false,
        authVersion: user?.authVersion || 0, passwordVersion: user?.passwordVersion || 0, delivery: "pending" };
      await db.insert("recoveryChallenge", challenge, user?.id || "");
      if (user) queueDelivery(async () => {
        const sent = await verifyRequest("Verifications", { To: user.phone, Channel: "whatsapp" });
        if (!/^VE[a-f0-9]{32}$/i.test(sent.sid || "") || sent.channel !== "whatsapp" || sent.to !== user.phone || sent.status !== "pending") throw invalidCode();
        await db.update("recoveryChallenge", challengeId, (value) => {
          if (value.used || value.expires <= clock() || value.purpose !== "recovery") throw invalidCode();
          value.verificationSid = sent.sid; value.delivery = "sent"; return value;
        });
      }, "recoveryChallenge", challengeId);
    }
    return { challengeId, message: genericMessage };
  }
  async function verify({ challengeId, code }) {
    checkChannel("whatsapp");
    if (typeof challengeId !== "string" || !/^[a-f0-9]{36}$/.test(challengeId) ||
        typeof code !== "string" || !/^\d{4,10}$/.test(code)) throw invalidCode();
    const challenge = await db.get("recoveryChallenge", challengeId);
    if (!challenge || challenge.purpose !== "recovery" || challenge.channel !== "whatsapp" ||
        challenge.used || challenge.expires <= clock() || challenge.attempts >= 5 || !challenge.userId ||
        challenge.delivery !== "sent" || !/^VE[a-f0-9]{32}$/i.test(challenge.verificationSid || "")) throw invalidCode();
    try { await db.update("recoveryChallenge", challengeId, (value) => {
      if (value.used || value.expires <= clock() || value.attempts >= 5) throw invalidCode();
      value.attempts++;
      return value;
    }); } catch (error) { if (error.status === 404) throw invalidCode(); throw error; }
    let result;
    try { result = await verifyRequest("VerificationCheck", { VerificationSid: challenge.verificationSid, Code: code }); } catch { throw invalidCode(); }
    if (result?.status !== "approved" || result.sid !== challenge.verificationSid || result.channel !== "whatsapp" || result.to !== challenge.phone) throw invalidCode();
    const user = await db.get("user", challenge.userId);
    const mapping = await db.get("verifiedPhone", digest(challenge.phone));
    const record = { ...challenge, identifier: challenge.phone };
    if (!currentUser(user, record) || mapping?.userId !== user.id) throw invalidCode();
    const token = tokenFor(user, "whatsapp", challenge.phone);
    try { await db.updateMany([
      { kind: "recoveryChallenge", id: challengeId, fn: (value) => {
        if (value.used || value.expires <= clock()) throw invalidCode();
        value.used = true; return value;
      } },
      { kind: "user", id: user.id, fn: (value) => { if (!currentUser(value, record)) throw invalidCode(); return value; } },
    ], [{ kind: "recoveryToken", item: token.record, owner: user.id }]); }
    catch (error) { if (error.status === 404) throw invalidCode(); throw error; }
    return { resetToken: token.raw, expiresIn: 1800 };
  }
  async function reset({ token, password: value }) {
    if (!readiness.emailReady && !readiness.whatsappReady)
      throw fail(503, "الاستعادة غير مفعّلة حاليًا. تواصل مع الدعم.");
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw invalidToken();
    const key = digest(token), record = await db.get("recoveryToken", key);
    if (!record || record.purpose !== "recovery" || record.used || record.expires <= clock() || !record.userId) throw invalidToken();
    const user = await db.get("user", record.userId);
    if (!currentUser(user, record)) throw invalidToken();
    const hash = await hashPassword(password(value));
    try { await db.updateMany([
      { kind: "recoveryToken", id: key, fn: (current) => {
        if (current.purpose !== "recovery" || current.used || current.expires <= clock()) throw invalidToken();
        current.used = true; return current;
      } },
      { kind: "user", id: user.id, fn: (current) => {
        if (!currentUser(current, record)) throw invalidToken();
        current.password = hash;
        current.authVersion = (current.authVersion || 0) + 1;
        current.passwordVersion = (current.passwordVersion || 0) + 1;
        return current;
      } },
    ]); } catch (error) { if (error.status === 404) throw invalidToken(); throw error; }
    return { ok: true, message: "تم تغيير كلمة المرور. سجّل الدخول مجددًا." };
  }
  return { readiness, request, verify, reset, settled: () => Promise.all([...deliveries]) };
}
