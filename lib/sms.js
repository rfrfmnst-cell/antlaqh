export function createSms({ env = process.env, fetchImpl = fetch, normalizePhone }) {
  const accountSid = String(env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
  const messagingServiceSid = String(env.TWILIO_MESSAGING_SERVICE_SID || "").trim();
  const from = String(env.TWILIO_SMS_FROM || "").trim();
  const enabled = env.SMS_NOTIFICATIONS_ENABLED === "true";
  const ready = !!(enabled && accountSid && authToken && (messagingServiceSid || from));

  async function send(to, message) {
    if (!ready) return { sent: false, reason: "not_configured" };
    const destination = normalizePhone(to);
    const body = String(message || "").trim().slice(0, 1200);
    if (!body) throw new Error("SMS message is empty.");

    const form = new URLSearchParams({ To: destination, Body: body });
    if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
    else form.set("From", from);

    let response;
    try {
      response = await fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch (error) {
      const wrapped = new Error("SMS provider is unavailable.");
      wrapped.cause = error;
      throw wrapped;
    }

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      const error = new Error("SMS provider rejected the message.");
      error.status = response.status;
      error.details = details.slice(0, 500);
      throw error;
    }

    const payload = await response.json().catch(() => ({}));
    return { sent: true, id: payload.sid || null, status: payload.status || null };
  }

  return {
    ready,
    provider: "twilio",
    mode: messagingServiceSid ? "messaging_service" : from ? "sender" : "disabled",
    send,
  };
}
