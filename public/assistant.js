const spark =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></svg>';
const host = document.createElement("div");
host.className = "ai-widget";
host.innerHTML = `<button class="ai-launcher" type="button" aria-label="فتح مساعد إنطلاقة" aria-haspopup="dialog" aria-expanded="false">${spark}<span>مساعد إنطلاقة</span></button><dialog class="ai-panel" aria-labelledby="ai-title"><header class="ai-header"><div class="ai-avatar">${spark}</div><div><h2 id="ai-title">مساعد إنطلاقة</h2><p>خطوتك القادمة، تبدأ بسؤال.</p></div><button class="ai-close" type="button" aria-label="إغلاق المساعد">×</button></header><div class="ai-status" role="status">جارٍ التحقق من توفر المساعد…</div><div class="ai-conversation" role="log" aria-live="polite" aria-label="المحادثة"><div class="ai-intro"><span class="ai-kicker">مساحة لفكرتك</span><h3>كيف نساعد مشروعك<br>على الانطلاق؟</h3><p>اكتشف الخدمة المناسبة ورتّب أفكارك ومتطلبات مشروعك.</p><div class="ai-suggestions"><button type="button" data-ai-prompt="أريد إنشاء متجر إلكتروني. ما المعلومات التي أجهزها للبدء؟">أريد إطلاق متجر <span>↗</span></button><button type="button" data-ai-prompt="كيف يمكن توظيف الذكاء الاصطناعي في مشروعي؟">أوظّف الذكاء الاصطناعي <span>↗</span></button><button type="button" data-ai-prompt="أريد البدء في البيع على نون أو أمازون. ما الخطوة الأولى؟">أبدأ على نون أو أمازون <span>↗</span></button></div></div></div><div class="ai-error" role="alert" hidden><span></span><button type="button" class="ai-retry" hidden>إعادة المحاولة</button></div><form class="ai-form"><label class="sr-only" for="ai-message">رسالتك لمساعد إنطلاقة</label><textarea id="ai-message" placeholder="حدّثنا عن فكرتك…" rows="2" maxlength="3000" required disabled></textarea><button class="ai-send" type="submit" aria-label="إرسال الرسالة" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 19 0-14m-6 6 6-6 6 6"/></svg></button></form><div class="ai-privacy">تُرسل رسائلك إلى OpenAI لإنتاج الرد. لا ترسل كلمات المرور أو بيانات الدفع. قد يخطئ المساعد.</div><footer class="ai-footer"><a href="#/services" data-ai-link>خدماتنا</a><a href="#/support" data-ai-link>تواصل مع الفريق</a><button class="ai-clear" type="button">محادثة جديدة</button></footer></dialog>`;
document.body.append(host);
const dialog = host.querySelector("dialog");
const launcher = host.querySelector(".ai-launcher");
const conversation = host.querySelector(".ai-conversation");
const initialContent = conversation.innerHTML;
const input = host.querySelector("textarea");
const send = host.querySelector(".ai-send");
const errorBox = host.querySelector(".ai-error");
const retry = host.querySelector(".ai-retry");
const status = host.querySelector(".ai-status");
let ready = false,
  busy = false,
  history = [],
  failedMessages = null,
  controller = null,
  previousFocus = null;

function appendMessage(role, content) {
  const bubble = document.createElement("div");
  bubble.className = `ai-message ai-${role}`;
  const label = document.createElement("span");
  label.className = "ai-message-label";
  label.textContent = role === "user" ? "أنت" : "إنطلاقة · ذكاء اصطناعي";
  const text = document.createElement("p");
  text.textContent = content;
  bubble.append(label, text);
  conversation.append(bubble);
  conversation.scrollTop = conversation.scrollHeight;
}
function updateControls() {
  input.disabled = !ready || busy;
  send.disabled = !ready || busy;
  host
    .querySelectorAll("[data-ai-prompt]")
    .forEach((b) => (b.disabled = !ready || busy));
  retry.disabled = busy;
  send.classList.toggle("ai-loading", busy);
  dialog.setAttribute("aria-busy", String(busy));
}
async function checkAvailability() {
  try {
    const response = await fetch("/api/config", { credentials: "same-origin" });
    if (!response.ok) throw Error();
    ready = (await response.json()).assistantReady === true;
    status.textContent = ready
      ? "مساعد ذكي لاكتشاف الخدمات وتوضيح الخطوة التالية"
      : "الردود الذكية غير مفعّلة حاليًا. تصفّح خدماتنا أو تواصل مع الفريق.";
  } catch {
    ready = false;
    status.textContent = "تعذر الاتصال. يمكنك التواصل مع فريق إنطلاقة.";
  }
  status.classList.toggle("ai-available", ready);
  updateControls();
}
function close() {
  dialog.close();
  launcher.setAttribute("aria-expanded", "false");
  if (previousFocus?.isConnected) previousFocus.focus();
}
async function open() {
  previousFocus = document.activeElement;
  if (!dialog.open) dialog.showModal();
  launcher.setAttribute("aria-expanded", "true");
  host.querySelector(".ai-close").focus();
  await checkAvailability();
  if (ready && !busy && dialog.open) input.focus();
}
async function request(messages) {
  busy = true;
  failedMessages = null;
  errorBox.hidden = true;
  updateControls();
  const progress = document.createElement("div");
  progress.className = "ai-thinking";
  progress.textContent = "يرتّب المساعد الرد…";
  conversation.append(progress);
  conversation.scrollTop = conversation.scrollHeight;
  const currentController = new AbortController();
  controller = currentController;
  const timer = setTimeout(() => currentController.abort(), 30000);
  try {
    const response = await fetch("/api/assistant", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: currentController.signal,
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "تعذر الحصول على الرد.");
    if (typeof result.reply !== "string" || !result.reply.trim())
      throw Error("لم يصل رد مكتمل. أعد المحاولة.");
    if (controller !== currentController) return;
    appendMessage("assistant", result.reply);
    history = [
      ...messages,
      { role: "assistant", content: result.reply.slice(0, 3000) },
    ];
  } catch (error) {
    if (controller !== currentController) return;
    failedMessages = messages;
    errorBox.querySelector("span").textContent =
      error.name === "AbortError"
        ? "استغرق الرد وقتًا أطول من المتوقع. حاول مجددًا."
        : error.message;
    errorBox.hidden = false;
    retry.hidden = false;
  } finally {
    clearTimeout(timer);
    progress.remove();
    if (controller === currentController) {
      busy = false;
      controller = null;
      updateControls();
      if (dialog.open && ready) input.focus();
    }
  }
}
host.querySelector(".ai-form").addEventListener("submit", (event) => {
  event.preventDefault();
  event.stopPropagation();
  const message = input.value.trim();
  if (!ready || busy || !message) return;
  let recent = history.slice(-10);
  while (
    recent.length &&
    recent.reduce((n, m) => n + m.content.length, 0) + message.length > 11500
  )
    recent = recent.slice(2);
  appendMessage("user", message);
  input.value = "";
  request([...recent, { role: "user", content: message }]);
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    host.querySelector(".ai-form").requestSubmit();
  }
});
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-assistant-open]")) {
    event.preventDefault();
    open();
  }
});
launcher.addEventListener("click", open);
host.querySelector(".ai-close").addEventListener("click", close);
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  close();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      close();
  }
});
host.querySelectorAll("[data-ai-prompt]").forEach((button) =>
  button.addEventListener("click", () => {
    if (!ready || busy) return;
    input.value = button.dataset.aiPrompt;
    input.focus();
  }),
);
host
  .querySelectorAll("[data-ai-link]")
  .forEach((link) => link.addEventListener("click", close));
retry.addEventListener("click", () => {
  if (failedMessages && !busy) request(failedMessages);
});
host.querySelector(".ai-clear").addEventListener("click", () => {
  const pending = controller;
  controller = null;
  pending?.abort();
  busy = false;
  history = [];
  failedMessages = null;
  errorBox.hidden = true;
  conversation.innerHTML = initialContent;
  conversation.querySelectorAll("[data-ai-prompt]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!ready || busy) return;
      input.value = button.dataset.aiPrompt;
      input.focus();
    }),
  );
  input.value = "";
  updateControls();
  if (ready) input.focus();
});
