const spark =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></svg>';
const host = document.createElement("div");
host.className = "ai-widget";
host.innerHTML = `<button class="ai-launcher" type="button" aria-label="فتح مساعد انطلاقة" aria-haspopup="dialog" aria-expanded="false" aria-controls="ai-panel">${spark}<span>مساعد انطلاقة</span></button>
<dialog id="ai-panel" class="ai-panel" aria-labelledby="ai-title" aria-describedby="ai-description">
  <header class="ai-header"><div class="ai-avatar">${spark}</div><div><h2 id="ai-title">مساعد انطلاقة</h2><p id="ai-description">يساعدك على اختيار الخدمة من معلومات انطلاقة.</p></div><button class="ai-close" type="button" aria-label="إغلاق المساعد">×</button></header>
  <div class="ai-status" role="status">جارٍ التحقق من توفر المساعد…</div>
  <div class="ai-conversation" role="log" aria-live="polite" aria-relevant="additions" aria-label="المحادثة">
    <div class="ai-intro"><span class="ai-kicker">إرشاد مجاني لبدايتك</span><h3>ما الخطوة المناسبة<br>لمشروعك؟</h3><p>مرحبًا، أنا مساعد انطلاقة. أساعدك في التعرف على خدماتنا وأسعار البداية وعرض الإطلاق ورحلة الطلب. اختر سؤالًا أو اكتب احتياجك.</p>
      <div class="ai-suggestions">
        <button type="button" data-ai-prompt="أريد موقعًا جاهزًا. ما الخيارات وأسعار البداية؟" disabled>أختار موقعًا جاهزًا <span aria-hidden="true">↗</span></button>
        <button type="button" data-ai-prompt="أريد إنشاء متجر إلكتروني. ما الخدمة والسعر وما الذي يشمله؟" disabled>أبدأ متجرًا إلكترونيًا <span aria-hidden="true">↗</span></button>
        <button type="button" data-ai-prompt="ما عرض الإطلاق وكيف أستخدم كود الخصم؟" disabled>أتعرف على عرض الإطلاق <span aria-hidden="true">↗</span></button>
        <button type="button" data-ai-prompt="كيف تبدأ رحلة الطلب وعرض السعر والعقد والدفع؟" disabled>أفهم رحلة الطلب والدفع <span aria-hidden="true">↗</span></button>
      </div>
    </div>
  </div>
  <div class="ai-error" role="alert" hidden><span></span><button type="button" class="ai-retry" hidden>إعادة المحاولة</button></div>
  <form class="ai-form"><label class="sr-only" for="ai-message">رسالتك لمساعد انطلاقة</label><textarea id="ai-message" placeholder="مثال: أحتاج موقعًا لمقهى…" rows="2" maxlength="3000" aria-describedby="ai-privacy" required disabled></textarea><button class="ai-send" type="submit" aria-label="إرسال الرسالة" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 19 0-14m-6 6 6-6 6 6"/></svg></button></form>
  <div id="ai-privacy" class="ai-privacy">لا يصل المساعد إلى حسابك أو ملفاتك. تبقى المحادثة في هذه الصفحة حتى تمسحها أو تحدّث الصفحة. لا ترسل كلمات المرور أو بيانات الدفع.</div>
  <footer class="ai-footer"><a href="#/services" data-ai-link>خدماتنا</a><a href="#/start" data-ai-link>ابدأ طلبًا</a><button class="ai-clear" type="button" aria-label="مسح المحادثة وبدء محادثة جديدة">محادثة جديدة</button></footer>
</dialog>`;
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
  serviceIds = new Set(),
  busy = false,
  history = [],
  failedMessages = null,
  controller = null,
  availabilityController = null,
  openingGeneration = 0,
  previousFocus = null;

function allowedLink(href) {
  if (typeof href !== "string") return false;
  if (["#/services", "#/ready-websites", "#/launch-offer", "#/start", "#/support", "#/terms", "#/dashboard", "/demos/business/", "/demos/portfolio/", "/demos/restaurant/"].includes(href)) return true;
  const service = href.match(/^#\/service\/([a-z0-9-]+)$/);
  const start = href.match(/^#\/start\?service=([a-z0-9-]+)$/);
  return Boolean((service || start) && serviceIds.has((service || start)[1]));
}
function appendMessage(role, content, links = []) {
  const bubble = document.createElement("div");
  bubble.className = `ai-message ai-${role}`;
  const label = document.createElement("span");
  label.className = "ai-message-label";
  label.textContent = role === "user" ? "أنت" : "مساعد انطلاقة";
  const text = document.createElement("p");
  text.textContent = content;
  bubble.append(label, text);
  if (role === "assistant" && Array.isArray(links)) {
    const actions = document.createElement("div");
    actions.className = "ai-message-links";
    const seen = new Set();
    for (const link of links.slice(0, 6)) {
      if (!link || typeof link.label !== "string" || !link.label.trim() || !allowedLink(link.href) || seen.has(link.href)) continue;
      seen.add(link.href);
      const anchor = document.createElement("a");
      anchor.textContent = link.label.slice(0, 120);
      anchor.setAttribute("href", link.href);
      if (link.href.startsWith("/demos/")) {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
        anchor.setAttribute("aria-label", `${link.label.slice(0, 120)} (يفتح في علامة تبويب جديدة)`);
      }
      anchor.addEventListener("click", close);
      actions.append(anchor);
    }
    if (actions.children.length) bubble.append(actions);
  }
  conversation.append(bubble);
  conversation.scrollTop = conversation.scrollHeight;
}
function updateControls() {
  input.disabled = !ready || busy;
  send.disabled = !ready || busy;
  host
    .querySelectorAll("[data-ai-prompt]")
    .forEach((b) => (b.disabled = !ready || busy));
  retry.disabled = !ready || busy;
  send.classList.toggle("ai-loading", busy);
  dialog.setAttribute("aria-busy", String(busy));
}
async function checkAvailability() {
  availabilityController?.abort();
  const currentController = new AbortController();
  availabilityController = currentController;
  const timer = setTimeout(() => currentController.abort(), 8000);
  ready = false;
  status.textContent = "جارٍ التحقق من توفر المساعد…";
  updateControls();
  try {
    const response = await fetch("/api/config", {
      credentials: "same-origin",
      cache: "no-store",
      signal: currentController.signal,
    });
    if (!response.ok) throw Error();
    const config = await response.json();
    if (availabilityController !== currentController) return;
    ready = config.assistantReady === true;
    serviceIds = new Set(Array.isArray(config.services) ? config.services.map(service => service?.id).filter(id => typeof id === "string") : []);
    const privacy = host.querySelector(".ai-privacy");
    if (privacy) privacy.textContent = config.assistantMode === "openai"
      ? "تستخدم المحادثة خدمة مساعدة خارجية. لا يصل المساعد إلى حسابك أو ملفاتك. لا ترسل كلمات المرور أو بيانات الدفع. راجع التفاصيل في سياسة الخصوصية."
      : "لا يصل المساعد إلى حسابك أو ملفاتك. تبقى المحادثة في هذه الصفحة حتى تمسحها أو تحدّث الصفحة. لا ترسل كلمات المرور أو بيانات الدفع.";
    status.textContent = ready
      ? config.assistantMode === "guided"
        ? "الإرشاد المجاني متاح الآن من معلومات خدمات انطلاقة."
        : "المساعد متاح لاكتشاف الخدمات وتوضيح الخطوة التالية."
      : "المساعد غير متاح حاليًا. تصفّح خدماتنا أو تواصل مع الفريق.";
  } catch {
    if (availabilityController !== currentController) return;
    ready = false;
    status.textContent = "تعذر الاتصال. يمكنك التواصل مع فريق انطلاقة.";
  } finally {
    clearTimeout(timer);
    if (availabilityController === currentController) {
      availabilityController = null;
      status.classList.toggle("ai-available", ready);
      updateControls();
    }
  }
}
function showError(message, canRetry = false) {
  errorBox.querySelector("span").textContent = message;
  errorBox.hidden = false;
  retry.hidden = !canRetry;
}
function close() {
  openingGeneration++;
  dialog.close();
  launcher.setAttribute("aria-expanded", "false");
  if (previousFocus?.isConnected) previousFocus.focus();
}
async function open() {
  const generation = ++openingGeneration;
  if (!dialog.open) {
    previousFocus = document.activeElement;
    dialog.showModal();
  }
  launcher.setAttribute("aria-expanded", "true");
  host.querySelector(".ai-close").focus();
  await checkAvailability();
  if (generation === openingGeneration && ready && !busy && dialog.open) input.focus();
  return generation;
}
async function request(messages) {
  busy = true;
  failedMessages = null;
  errorBox.hidden = true;
  retry.hidden = true;
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
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error("تعذر الحصول على الرد. حاول مجددًا أو تواصل مع الفريق.");
    }
    if (controller !== currentController) return;
    if (!response.ok) {
      if (response.status === 503) {
        ready = false;
        status.textContent = "المساعد غير متاح مؤقتًا. تصفّح خدماتنا أو تواصل مع الفريق.";
        status.classList.remove("ai-available");
      }
      throw Error(typeof result?.error === "string" ? result.error : "تعذر الحصول على الرد.");
    }
    if (typeof result?.reply !== "string" || !result.reply.trim())
      throw Error("لم يصل رد مكتمل. أعد المحاولة.");
    if (controller !== currentController) return;
    appendMessage("assistant", result.reply, result.links);
    history = [
      ...messages,
      { role: "assistant", content: result.reply.slice(0, 3000) },
    ];
  } catch (error) {
    if (controller !== currentController) return;
    failedMessages = messages;
    showError(
      error.name === "AbortError"
        ? "استغرق الرد وقتًا أطول من المتوقع. حاول مجددًا."
        : error instanceof TypeError
          ? "تعذر الاتصال. حاول مجددًا أو تواصل مع الفريق."
          : error.message,
      ready,
    );
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
  if (message.length > 3000) {
    showError("اختصر رسالتك إلى 3000 حرف قبل إرسالها.");
    return;
  }
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
  const trigger = event.target.closest("[data-assistant-open]");
  if (trigger) {
    event.preventDefault();
    const draft = trigger.hasAttribute("data-assistant-draft") ? document.getElementById("home-ai-draft")?.value || "" : trigger.dataset.assistantPrompt || "";
    return open().then((generation) => {
      if (generation !== openingGeneration || !dialog.open || busy) return;
      if (draft) input.value = draft.slice(0, 3000);
      if (ready) {
        input.focus();
        if (draft.trim()) host.querySelector(".ai-form").requestSubmit();
      }
    });
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
conversation.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ai-prompt]");
  if (!button || !ready || busy) return;
  input.value = button.dataset.aiPrompt;
  host.querySelector(".ai-form").requestSubmit();
});
host
  .querySelectorAll("[data-ai-link]")
  .forEach((link) => link.addEventListener("click", close));
retry.addEventListener("click", () => {
  if (failedMessages && ready && !busy) request(failedMessages);
});
host.querySelector(".ai-clear").addEventListener("click", () => {
  openingGeneration++;
  const pending = controller;
  controller = null;
  pending?.abort();
  busy = false;
  history = [];
  failedMessages = null;
  errorBox.hidden = true;
  conversation.innerHTML = initialContent;
  input.value = "";
  updateControls();
  if (ready) input.focus();
});
