import test from "node:test";
import assert from "node:assert/strict";
import { createSms } from "../lib/sms.js";

const normalizePhone = (value) => {
  const raw = String(value).replace(/\s+/g, "");
  if (/^05\d{8}$/.test(raw)) return "+966" + raw.slice(1);
  if (/^\+\d{8,15}$/.test(raw)) return raw;
  throw new Error("invalid phone");
};

test("SMS stays disabled unless explicitly enabled and configured", async () => {
  const sms = createSms({ env: {}, fetchImpl: async () => { throw new Error("must not call"); }, normalizePhone });
  assert.equal(sms.ready, false);
  assert.deepEqual(await sms.send("0550000000", "hello"), { sent: false, reason: "not_configured" });
});

test("SMS sends through a Twilio Messaging Service", async () => {
  let request;
  const sms = createSms({
    env: {
      SMS_NOTIFICATIONS_ENABLED: "true",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_MESSAGING_SERVICE_SID: "MG123",
    },
    normalizePhone,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ sid: "SM123", status: "queued" }) };
    },
  });

  const result = await sms.send("0550000000", "تم تحديث طلبك");
  assert.equal(sms.ready, true);
  assert.equal(sms.mode, "messaging_service");
  assert.deepEqual(result, { sent: true, id: "SM123", status: "queued" });
  assert.match(request.url, /Accounts\/AC123\/Messages\.json$/);
  const body = new URLSearchParams(request.options.body);
  assert.equal(body.get("To"), "+966550000000");
  assert.equal(body.get("MessagingServiceSid"), "MG123");
  assert.equal(body.get("Body"), "تم تحديث طلبك");
  assert.equal(body.get("From"), null);
});

test("SMS can use an approved sender when no Messaging Service is configured", async () => {
  let form;
  const sms = createSms({
    env: {
      SMS_NOTIFICATIONS_ENABLED: "true",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_SMS_FROM: "ANTLAQH",
    },
    normalizePhone,
    fetchImpl: async (_url, options) => {
      form = new URLSearchParams(options.body);
      return { ok: true, json: async () => ({ sid: "SM456" }) };
    },
  });
  await sms.send("+966550000001", "رسالة");
  assert.equal(sms.mode, "sender");
  assert.equal(form.get("From"), "ANTLAQH");
  assert.equal(form.get("MessagingServiceSid"), null);
});

test("SMS provider errors are surfaced without leaking credentials", async () => {
  const sms = createSms({
    env: {
      SMS_NOTIFICATIONS_ENABLED: "true",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_SMS_FROM: "ANTLAQH",
    },
    normalizePhone,
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => "bad sender" }),
  });
  await assert.rejects(() => sms.send("+966550000001", "رسالة"), /rejected/);
});
