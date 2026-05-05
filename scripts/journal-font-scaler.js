const MODULE_ID = "journal-font-scaler";
const SETTING_SCALE = "globalScale";
const SCALE_MIN = 0.5;
const SCALE_MAX = 3.0;
const SCALE_DEFAULT = 1.0;
const SCALE_STEP_BUTTON = 0.1;
const SCALE_STEP_WHEEL = 0.05;
const SCALE_VAR = "--jfs-scale";
const BTN_MARKER = "data-jfs-btn";
const WHEEL_MARKER = "data-jfs-wheel";
const CSS_MARKER = "data-jfs-css";
const CSS_HREF = "/modules/journal-font-scaler/styles/journal-font-scaler.css";
const POST_MOVE_DELAY_MS = 100;

const clampScale = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return SCALE_DEFAULT;
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, n));
};
const roundScale = (v) => Math.round(v * 100) / 100;

function getCurrentScale() {
  return clampScale(game.settings.get(MODULE_ID, SETTING_SCALE));
}

async function setScale(value) {
  const next = roundScale(clampScale(value));
  await game.settings.set(MODULE_ID, SETTING_SCALE, next);
}

function applyScaleToElement(rootEl, scale) {
  if (!(rootEl instanceof HTMLElement)) return;
  rootEl.style.setProperty(SCALE_VAR, String(scale));
}

function ensureCssInDocument(doc) {
  if (!doc || doc === document) return;
  if (!doc.head) return;
  if (doc.querySelector(`link[${CSS_MARKER}]`)) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_HREF;
  link.setAttribute(CSS_MARKER, "");
  doc.head.appendChild(link);
}

function applyScaleToAllOpenSheets(scale) {
  const instances = foundry.applications?.instances;
  if (instances) {
    for (const app of instances.values()) {
      const el = app?.element;
      if (!(el instanceof HTMLElement)) continue;
      if (!el.classList.contains("journal-sheet")) continue;
      ensureCssInDocument(el.ownerDocument);
      applyScaleToElement(el, scale);
    }
    return;
  }
  for (const el of document.querySelectorAll(".application.journal-sheet")) {
    applyScaleToElement(el, scale);
  }
}

let _pendingPersistScale = null;
let _persistRafId = null;
function schedulePersistScale(value) {
  _pendingPersistScale = value;
  if (_persistRafId !== null) return;
  _persistRafId = requestAnimationFrame(() => {
    _persistRafId = null;
    const v = _pendingPersistScale;
    _pendingPersistScale = null;
    game.settings.set(MODULE_ID, SETTING_SCALE, v);
  });
}

function makeHeaderButton({ icon, tooltipKey, action }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `header-control icon fa-solid ${icon}`;
  btn.setAttribute(BTN_MARKER, action);
  btn.setAttribute("data-tooltip", game.i18n.localize(tooltipKey));
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const current = getCurrentScale();
    if (action === "in") await setScale(current + SCALE_STEP_BUTTON);
    else if (action === "out") await setScale(current - SCALE_STEP_BUTTON);
    else if (action === "reset") await setScale(SCALE_DEFAULT);
  });
  return btn;
}

function injectHeaderButtons(sheetRoot) {
  const header = sheetRoot.querySelector("header.window-header");
  if (!header) return;
  if (header.querySelector(`[${BTN_MARKER}]`)) return;

  const closeBtn = header.querySelector("button.header-control.fa-xmark");
  const reference = closeBtn ?? null;

  const buttons = [
    makeHeaderButton({ icon: "fa-search-minus", tooltipKey: "JFS.ButtonZoomOut", action: "out" }),
    makeHeaderButton({ icon: "fa-rotate-left",  tooltipKey: "JFS.ButtonReset",   action: "reset" }),
    makeHeaderButton({ icon: "fa-search-plus",  tooltipKey: "JFS.ButtonZoomIn",  action: "in" })
  ];

  for (const btn of buttons) header.insertBefore(btn, reference);
}

function attachWheelHandler(sheetRoot) {
  const content = sheetRoot.querySelector("section.journal-entry-content");
  if (!content) return;

  const docKey = content.ownerDocument === document ? "main" : "external";
  if (content.getAttribute(WHEEL_MARKER) === docKey) return;

  const previous = content._jfsWheelHandler;
  if (previous) content.removeEventListener("wheel", previous, false);

  const handler = (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    const inline = sheetRoot.style.getPropertyValue(SCALE_VAR);
    const current = inline ? Number(inline) : getCurrentScale();
    const delta = ev.deltaY > 0 ? -SCALE_STEP_WHEEL : SCALE_STEP_WHEEL;
    const next = roundScale(clampScale(current + delta));
    if (next === current) return;
    applyScaleToAllOpenSheets(next);
    schedulePersistScale(next);
  };
  content.addEventListener("wheel", handler, { passive: false });
  content._jfsWheelHandler = handler;
  content.setAttribute(WHEEL_MARKER, docKey);
}

function setupSheet(rootEl) {
  applyScaleToElement(rootEl, getCurrentScale());
  injectHeaderButtons(rootEl);
  attachWheelHandler(rootEl);
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);

  game.settings.register(MODULE_ID, SETTING_SCALE, {
    scope: "client",
    config: false,
    type: Number,
    default: SCALE_DEFAULT,
    onChange: (value) => applyScaleToAllOpenSheets(clampScale(value))
  });
});

Hooks.on("renderJournalEntrySheet", (app, html) => {
  const root = (html instanceof HTMLElement) ? html : (html?.[0] ?? null);
  if (!root) return;
  setupSheet(root);

  // The detach action moves the DOM into a separate Electron browser window
  // asynchronously *after* the render hook fires (which is why ownerDocument
  // is still the main document at hook time). Re-check after the move and
  // wire up the new document context if needed.
  setTimeout(() => {
    const el = app?.element;
    if (!(el instanceof HTMLElement)) return;
    if (el.ownerDocument === document) return;
    ensureCssInDocument(el.ownerDocument);
    applyScaleToElement(el, getCurrentScale());
    injectHeaderButtons(el);
    attachWheelHandler(el);
  }, POST_MOVE_DELAY_MS);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
});
