/* LV-Prüfstand online demo only: a guided click-through tour ("Tour starten" in the banner).
   It switches views by clicking the real view buttons and opens one finding and its source page.
   It never clicks a review button: confirming or rejecting stays with the visitor. */
(function () {
  "use strict";

  const SEEN = "lv-pruefstand-demo-tour-seen";
  const $ = (selector, root) => (root || document).querySelector(selector);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(test, ms) {
    const end = Date.now() + (ms || 4000);
    while (Date.now() < end) {
      const value = test();
      if (value) return value;
      await sleep(50);
    }
    return test();
  }

  function shown(node) {
    if (!node) return false;
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  async function openView(name) {
    const tab = document.getElementById("tab-" + name);
    const section = document.getElementById("view-" + name);
    if (tab && (!section || section.hidden || !tab.classList.contains("active"))) tab.click();
    await waitFor(() => section && !section.hidden);
  }

  const STEPS = [
    { title: "Bauwerk", text: "Alle Leistungsverzeichnisse als ein Gebäude. Jede Zahl zählt die Funde zwischen zwei Gewerken.",
      target: "#bauwerk-root .matrix-scroll",
      async enter() { await openView("bauwerk"); } },
    { title: "Fund", text: "Jeder Fund ist eine Frage. Links und rechts stehen die Zitate aus beiden Listen.",
      target: "#fund-detail .sources",
      async enter() {
        await openView("bauwerk");
        const cell = await waitFor(() => $("#bauwerk-root td.cell.has"));
        if (cell) {
          cell.click();
          const finding = await waitFor(() => $("#bauwerk-root .cell-panel .cell-finding"));
          if (finding) finding.click();
        }
        await openView("fund");
      } },
    { title: "Quelle zeigen", text: "Ein Klick zeigt die Originalseite, das Zitat ist gelb markiert.",
      target: "#fund-detail .source",
      async enter() {
        await openView("fund");
        /* The view can render again after the click (the answer of api/findings), which closes the page. */
        const page = () => $("#fund-detail .page-panel img, #fund-detail .page-panel .no-image");
        for (let attempt = 0; attempt < 3; attempt++) {
          const button = await waitFor(() => $("#fund-detail .show-source"));
          if (button && button.textContent === "Quelle zeigen") button.click();
          if (await waitFor(page, attempt === 2 ? 3000 : 400)) {
            await sleep(200);
            if (page()) break;
          }
        }
      } },
    { title: "Prüfen", text: "Hier entscheidet ein Mensch: B = bestätigt, V = verworfen, U = unklar.",
      target: "#review-form .status-buttons",
      async enter() { await openView("pruefen"); } },
    { title: "Einzel-LV", text: "Grundprüfungen B1 bis B12 je Liste, zum Beispiel ein Rechenfehler.",
      target: "#einzel-root",
      async enter() { await openView("einzel"); } },
    { title: "Vergleich", text: "Ausschreibung gegen Auftrag: was kam dazu, was fiel weg.",
      target: "#vergleich-root",
      async enter() { await openView("vergleich"); } },
    { title: "Messung", text: "Unsere Messwerte aus dem echten Challenge-Projekt.",
      target: "#messung-root",
      async enter() { await openView("messung"); } },
    { title: "Export", text: "Nur bestätigte Funde gehen hinaus: Fragenliste, markiertes LV, Risikobericht. In der Demo zeigen die Exporte den Demo-Stand.",
      target: "#pruefen-scroll .export-bar",
      async enter() { await openView("pruefen"); } },
    { title: "Fertig", text: "Jetzt selbst ausprobieren.", target: null, async enter() {} },
  ];
  const COUNTED = STEPS.length - 1;

  let tour = null;

  function build() {
    const catcher = document.createElement("div");
    catcher.className = "tour-catcher";
    const hole = document.createElement("div");
    hole.className = "tour-hole";
    const card = document.createElement("div");
    card.className = "tour-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "tour-title");
    card.innerHTML = '<p class="tour-count" id="tour-count"></p><h2 class="tour-title" id="tour-title"></h2>' +
      '<p class="tour-text" id="tour-text"></p><div class="tour-buttons">' +
      '<button type="button" class="tour-back" id="tour-back">Zurück</button>' +
      '<button type="button" class="tour-next" id="tour-next">Weiter</button>' +
      '<button type="button" class="tour-end" id="tour-end">Beenden</button></div>';
    document.body.append(catcher, hole, card);
    card.querySelector("#tour-back").addEventListener("click", () => go(tour.index - 1));
    card.querySelector("#tour-next").addEventListener("click", () => go(tour.index + 1));
    card.querySelector("#tour-end").addEventListener("click", close);
    return { catcher: catcher, hole: hole, card: card };
  }

  function place() {
    if (!tour) return;
    const step = STEPS[tour.index];
    const card = tour.parts.card;
    const hole = tour.parts.hole;
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const node = step.target ? $(step.target) : null;
    const narrow = width < 640;
    card.classList.toggle("docked", narrow);
    if (!node || !shown(node)) {
      hole.classList.add("none");
      card.classList.add("center");
      card.style.left = card.style.top = "";
      return;
    }
    card.classList.remove("center");
    hole.classList.remove("none");
    const pad = 6;
    const box = node.getBoundingClientRect();
    const left = Math.max(4, box.left - pad);
    const top = Math.max(4, box.top - pad);
    const right = Math.min(width - 4, box.right + pad);
    const bottom = Math.min(height - 4, box.bottom + pad);
    hole.style.left = left + "px";
    hole.style.top = top + "px";
    hole.style.width = Math.max(0, right - left) + "px";
    hole.style.height = Math.max(0, bottom - top) + "px";
    if (narrow) { card.style.left = card.style.top = ""; return; }
    const cardBox = card.getBoundingClientRect();
    let y = bottom + 12;
    if (y + cardBox.height > height - 8) y = top - cardBox.height - 12;
    if (y < 8) y = height - cardBox.height - 16;
    const x = Math.min(Math.max(8, left), width - cardBox.width - 8);
    card.style.left = x + "px";
    card.style.top = Math.max(8, y) + "px";
  }

  async function go(index) {
    if (!tour) return;
    if (index < 0) return;
    if (index >= STEPS.length) { close(); return; }
    const token = ++tour.token;
    tour.index = index;
    const step = STEPS[index];
    const card = tour.parts.card;
    card.dataset.step = String(index + 1);
    card.dataset.ready = "false";
    card.querySelector("#tour-count").textContent = index < COUNTED ? (index + 1) + " / " + COUNTED : "";
    card.querySelector("#tour-title").textContent = step.title;
    card.querySelector("#tour-text").textContent = step.text;
    card.querySelector("#tour-back").disabled = index === 0;
    card.querySelector("#tour-next").textContent = index === STEPS.length - 1 ? "Fertig" : "Weiter";
    card.querySelector("#tour-end").hidden = index === STEPS.length - 1;
    card.querySelector("#tour-next").focus({ preventScroll: true });
    try {
      await step.enter();
    } catch (error) {
      /* a missing element only leaves the card without a highlight */
    }
    if (!tour || token !== tour.token) return;
    const node = step.target ? await waitFor(() => { const found = $(step.target); return shown(found) && found; }) : null;
    if (!tour || token !== tour.token) return;
    if (node) {
      const tall = node.getBoundingClientRect().height > window.innerHeight * 0.6;
      node.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest" });
      await sleep(80);
      if (!tour || token !== tour.token) return;
    }
    place();
    card.dataset.ready = "true";
    card.querySelector("#tour-next").focus({ preventScroll: true });
  }

  function cardButtons() {
    return Array.from(tour.parts.card.querySelectorAll("button")).filter((button) => !button.disabled && shown(button));
  }

  /* Keys never reach the page behind the tour: Tab cycles over the card's buttons, and a key on any
     element outside the card does nothing (so Enter or Space cannot press "Bestätigt"). */
  function onKey(event) {
    if (!tour) return;
    event.stopImmediatePropagation();
    const inside = tour.parts.card.contains(event.target);
    if (event.key === "Tab") {
      event.preventDefault();
      const buttons = cardButtons();
      if (!buttons.length) return;
      const at = buttons.indexOf(document.activeElement);
      const next = at < 0 ? 0 : (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus({ preventScroll: true });
      return;
    }
    if (!inside) event.preventDefault();
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); go(tour.index + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(tour.index - 1); }
  }

  function onKeyUp(event) {
    if (!tour) return;
    event.stopImmediatePropagation();
    if (!tour.parts.card.contains(event.target)) event.preventDefault();
  }

  function onFocus(event) {
    if (!tour || tour.parts.card.contains(event.target)) return;
    tour.parts.card.querySelector("#tour-next").focus({ preventScroll: true });
  }

  function start() {
    if (tour) return;
    try { localStorage.setItem(SEEN, "1"); } catch (error) { /* no storage */ }
    tour = { index: 0, token: 0, parts: build(), focus: document.activeElement };
    document.documentElement.classList.add("tour-open");
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    tour.timer = setInterval(place, 300);
    go(0);
  }

  function close() {
    if (!tour) return;
    const ending = tour;
    tour = null;
    clearInterval(ending.timer);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("focusin", onFocus, true);
    window.removeEventListener("resize", place);
    document.removeEventListener("scroll", place, true);
    ending.parts.catcher.remove();
    ending.parts.hole.remove();
    ending.parts.card.remove();
    document.documentElement.classList.remove("tour-open");
    const button = document.getElementById("tour-start");
    if (button) button.focus({ preventScroll: true });
  }

  function seen() {
    try { return localStorage.getItem(SEEN) === "1"; } catch (error) { return true; }
  }

  function wire() {
    const button = document.getElementById("tour-start");
    if (button) button.addEventListener("click", start);
    /* Auto-start once on the first visit; never inside a frame (the test pages) or a driven browser. */
    let framed = true;
    try { framed = window.top !== window; } catch (error) { framed = true; }
    if (!seen() && !framed && !navigator.webdriver) {
      waitFor(() => $("#bauwerk-root table.matrix, #fund-list [data-id]"), 5000).then(() => { if (!seen()) start(); });
    }
  }

  window.LVTour = { start: start, close: close, targets: STEPS.map((step) => step.target) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
