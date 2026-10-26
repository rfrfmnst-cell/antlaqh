import {createHmac,timingSafeEqual} from "node:crypto";
import {body,digest,fail} from "./security.js";
const MAX_BYTES=65536;

export function verifyTapCharge(data,hash,key) {
  if (!data || data.object!=="charge" || typeof hash!=="string" || !/^[a-f0-9]{64}$/i.test(hash))
    throw fail(403,"توقيع إشعار تاب غير صالح.");
  const id=String(data.id || "");
  const orderRef=String(data.reference?.order || "");
  const amount=Number(data.amount);
  const created=String(data.transaction?.created ?? "");
  const status=String(data.status || "");
  const currency=String(data.currency || "");
  if (!/^chg_[A-Za-z0-9_-]{8,}$/.test(id) ||
      !/^[A-Za-z0-9._:-]{8,255}$/.test(orderRef) ||
      !Number.isFinite(amount) || amount<=0 || !Number.isSafeInteger(Math.round(amount*100)) ||
      Math.abs(amount*100-Math.round(amount*100))>1e-6 ||
      currency!=="SAR" || !/^[A-Z_]{3,24}$/.test(status) ||
      !/^\d{10,17}$/.test(created)) throw fail(400,"بيانات إشعار تاب غير صالحة.");
  const encoded="x_id"+id+"x_amount"+amount.toFixed(2)+"x_currency"+currency+
    "x_gateway_reference"+String(data.reference?.gateway ?? "")+
    "x_payment_reference"+String(data.reference?.payment ?? "")+
    "x_status"+status+"x_created"+created;
  const expected=createHmac("sha256",key).update(encoded).digest();
  const supplied=Buffer.from(hash,"hex");
  if (supplied.length!==expected.length || !timingSafeEqual(supplied,expected))
    throw fail(403,"تعذر التحقق من توقيع تاب.");
  return {chargeId:id,orderRef,amountHalalas:Math.round(amount*100),currency,status,
    liveMode:data.live_mode === true,
    merchantId:String(data.merchant?.id || "")};
}

export function createTapWebhook({db,env=process.env,clock=Date.now}={}) {
  const key=String(env.TAP_SECRET_KEY || "").trim();
  const merchantId=String(env.TAP_MERCHANT_ID || "").trim();
  const enabled=env.TAP_CHECKOUT_ENABLED==="true" &&
    (/^sk_test_[A-Za-z0-9_-]{10,}$/.test(key) ||
      (env.TAP_ALLOW_LIVE==="true" && /^sk_live_[A-Za-z0-9_-]{10,}$/.test(key))) &&
    /^[A-Za-z0-9_-]{2,64}$/.test(merchantId);
  const readiness=Object.freeze({configured:enabled,verification:"hashstring",autoConfirmation:false});
  async function receive(req) {
    if (!enabled) throw fail(503,"إشعارات تاب غير مفعّلة.");
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json"))
      throw fail(415,"صيغة إشعار تاب غير مدعومة.");
    const raw=await body(req,MAX_BYTES);
    let data;
    try {data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));}
    catch {throw fail(400,"إشعار تاب ليس JSON صالحًا.");}
    const details=verifyTapCharge(data,String(req.headers.hashstring || ""),key);
    if (details.merchantId!==merchantId ||
      details.liveMode !== key.startsWith("sk_live_"))
      throw fail(403,"إشعار تاب لا يخص حساب التاجر المعرّف.");
    const attempt=await db.get("tapAttempt",digest(details.orderRef));
    // Never attribute a provider message to an order merely by its untrusted reference.
    if (attempt && (attempt.amount!==details.amountHalalas ||
      attempt.currency!==details.currency || attempt.chargeId!==details.chargeId))
      throw fail(409,"مرجع الدفع غير مطابق لمحاولة الطلب.");
    const receipt={
      ...details,id:digest(details.chargeId+":"+details.status),
      orderId:attempt?.orderId || null,
      verified:true,requiresReview:true,receivedAt:clock(),
    };
    if (!await db.get("tapReceipt",receipt.id)) {
      try {await db.insert("tapReceipt",receipt,attempt?.orderId || "");}
      catch(error) {
        if (error.code!=="ER_DUP_ENTRY" && !String(error.message).includes("UNIQUE constraint"))
          throw error;
      }
    }
    return "OK";
  }
  return {readiness,receive};
}
