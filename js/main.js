(function () {
  const settings = window.CAMPAIGN || {};
  const books = {
    kommer: "Souverän investieren für Einsteiger",
    finanzfluss: "Das einzige Buch, das Du über Finanzen lesen solltest",
    housel: "Über die Psychologie des Geldes"
  };
  const number = String(settings.whatsappNumber || "").replace(/\D/g, "");
  const organizer = document.getElementById("organizerName");
  if (organizer && settings.organizerName) organizer.textContent = settings.organizerName;
  const preview = document.getElementById("previewBar");
  if (preview && settings.launchReady) preview.remove();

  const stickyClaim = document.querySelector(".sticky-claim");
  if (stickyClaim) {
    const reserveSpace = () => document.documentElement.style.setProperty("--sticky-space", `${Math.ceil(stickyClaim.getBoundingClientRect().height)}px`);
    reserveSpace();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(reserveSpace).observe(stickyClaim);
    else window.addEventListener("resize", reserveSpace);
  }

  const picker = document.getElementById("bookPicker");
  const pickerStatus = document.getElementById("pickerStatus");
  const pendingRequests = {};
  let counters = null;
  let activeClaim = false;
  let epoch = 0;
  let refreshSequence = 0;

  function requestUuid() {
    if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
    if (typeof window.crypto?.getRandomValues !== "function") throw new Error("secure_random_unavailable");
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  async function requestCounter(url, options = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(new Error("request_timeout"));
      }, 15000);
    });
    try {
      // Bound the whole response, including JSON reading. Keep a Promise timeout
      // for older WebViews without AbortController as well.
      return await Promise.race([
        (async () => {
          const response = await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
          return { ok: response.ok, data: await response.json() };
        })(),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function status(bookId, text) {
    document.querySelectorAll(`[data-book-status="${bookId}"]`).forEach(el => { el.textContent = text; });
    if (pickerStatus) pickerStatus.textContent = text;
  }

  function render(data) {
    if (!data || !data.remaining) return;
    counters = data;
    Object.keys(books).forEach(id => {
      const count = Number(data.remaining[id]);
      if (!Number.isInteger(count) || count < 0 || count > 100) return;
      document.querySelectorAll(`[data-stock-value="${id}"]`).forEach(el => { el.textContent = String(count); });
      document.querySelectorAll(`[data-stock-bar="${id}"]`).forEach(el => { el.style.width = `${count}%`; });
      document.querySelectorAll(`[data-stock="${id}"]`).forEach(el => { el.classList.toggle("stock-empty", count === 0); });
      document.querySelectorAll(`[data-book="${id}"]`).forEach(el => {
        el.setAttribute("aria-disabled", String(activeClaim || (count === 0 && !pendingRequests[id])));
        const label = el.classList.contains("book-claim") ? el.querySelector("strong") : null;
        if (label) label.textContent = count === 0 ? (pendingRequests[id] ? "Reservierung erneut öffnen" : "Heute ausgeschöpft") : "Kostenlos zum Onlinekurs anmelden";
      });
      if (!activeClaim) document.querySelectorAll(`[data-book-status="${id}"]`).forEach(el => { el.textContent = count === 0 ? (pendingRequests[id] ? "Ihre vorige Anfrage erneut prüfen und WhatsApp öffnen." : "Heute vergeben · morgen wieder 100 Plätze") : "Tageswechsel um 00:00 Uhr · deutsche Ortszeit"; });
    });
  }

  async function refresh() {
    if (document.hidden || activeClaim) return;
    const started = epoch;
    const sequence = ++refreshSequence;
    try {
      const { ok, data } = await requestCounter("/claim-counter.php?action=inventory", { cache: "no-store" });
      if (!ok) throw new Error("unavailable");
      if (started === epoch && sequence === refreshSequence) render(data);
    } catch {
      if (!counters && started === epoch && sequence === refreshSequence) Object.keys(books).forEach(id => status(id, "Kontingent derzeit nicht abrufbar. Bitte erneut versuchen."));
    }
  }

  async function claim(event) {
    event.preventDefault();
    const bookId = event.currentTarget.dataset.book;
    if (activeClaim || !books[bookId]) return;
    if (!number) { status(bookId, "Der WhatsApp-Kontakt ist derzeit nicht verfügbar."); return; }
    if (counters && counters.remaining[bookId] === 0 && !pendingRequests[bookId]) { status(bookId, "Für dieses Buch sind heute alle Plätze vergeben."); return; }
    activeClaim = true;
    epoch++;
    document.querySelectorAll("[data-book]").forEach(el => { el.setAttribute("aria-disabled", "true"); });
    status(bookId, "Ihr Aktionsplatz wird reserviert …");
    try {
      const requestId = pendingRequests[bookId] || requestUuid();
      pendingRequests[bookId] = requestId;
      const { ok, data } = await requestCounter("/claim-counter.php?action=claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId, requestId }) });
      if (!ok && !data.remaining) throw new Error("unavailable");
      render(data);
      if (!data.accepted || data.conflict) {
        delete pendingRequests[bookId];
        status(bookId, "Für dieses Buch sind heute alle Plätze vergeben. Bitte wählen Sie einen anderen Titel.");
        return;
      }
      delete pendingRequests[bookId];
      status(bookId, "Platz reserviert. WhatsApp wird geöffnet …");
      const message = `Guten Tag, ich möchte mich für den kostenlosen Onlinekurs von Geldanlage für alle anmelden und das Buch „${books[bookId]}“ kostenlos anfordern. Meine Anfragekennung: ${data.requestId} (${data.claimDay}). Bitte helfen Sie mir bei der Registrierung. Ich sende meine Adresse erst nach einer Buchzusage.`;
      window.location.assign(`https://wa.me/${number}?text=${encodeURIComponent(message)}`);
    } catch (error) {
      status(bookId, error?.message === "secure_random_unavailable"
        ? "Bitte öffnen Sie diese Seite in einem aktuellen Browser, um einen Platz sicher zu reservieren."
        : "Verbindung unterbrochen. Bitte erneut klicken; dieselbe Anfrage wird nur einmal gezählt.");
    } finally {
      activeClaim = false;
      epoch++;
      document.querySelectorAll("[data-book]").forEach(el => { el.setAttribute("aria-disabled", String(counters?.remaining[el.dataset.book] === 0 && !pendingRequests[el.dataset.book])); });
    }
  }

  document.querySelectorAll("[data-book]").forEach(link => link.addEventListener("click", claim));
  document.querySelectorAll("[data-whatsapp]").forEach(link => {
    link.href = "#buecher";
    link.addEventListener("click", event => {
      if (!picker || typeof picker.showModal !== "function") return;
      event.preventDefault();
      if (pickerStatus) pickerStatus.textContent = "";
      picker.showModal();
      refresh();
    });
  });
  document.querySelector("[data-close-picker]")?.addEventListener("click", () => picker.close());
  picker?.addEventListener("click", event => {
    const box = picker.getBoundingClientRect();
    if (event.target === picker && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) picker.close();
  });
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", refresh);
  setInterval(refresh, 20000);
  refresh();
})();
