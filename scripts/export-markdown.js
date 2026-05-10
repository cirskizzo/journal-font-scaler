const MODULE_ID = "journal-scaler-plus";
const LOG_PREFIX = `${MODULE_ID} | export-markdown`;

const SETTING_MIN_ROLE = "exportMinimumRole";
const SETTING_DOWNLOAD_FOLDER = "defaultDownloadFolder";

function getMinimumRoleForExport() {
  return Number(game.settings.get(MODULE_ID, SETTING_MIN_ROLE));
}

function canUserExport(journal) {
  if (!journal) return false;
  if (game.user.role < getMinimumRoleForExport()) return false;
  return journal.testUserPermission(game.user, "OBSERVER");
}

function getDefaultDownloadFolder() {
  return String(game.settings.get(MODULE_ID, SETTING_DOWNLOAD_FOLDER) ?? "").trim();
}

function getJournalFromContextArgs(args) {
  // v14 V2 callback signatures vary:
  //   visible(li)              — 1 arg, the <li>
  //   onClick(event, li)       — 2 args, <li> is second
  // Be liberal: scan args for the first HTMLElement (or jQuery wrapper) carrying
  // a data-entry-id, so future signature tweaks won't break us.
  for (const a of args ?? []) {
    const el = a instanceof HTMLElement ? a : a?.[0];
    const id = el?.dataset?.entryId;
    if (id) return game.journal.get(id);
  }
  return null;
}

// Document types we render as Obsidian wikilinks (one note per entity).
// Everything else (Item, Macro, RollTable, Compendium-of-non-listed, etc.) → italics.
const WIKILINKABLE_TYPES = new Set([
  "JournalEntry",
  "JournalEntryPage",
  "Actor",
  "Scene"
]);

const KNOWN_DOC_TYPES = new Set([
  "Actor", "Item", "Scene", "JournalEntry", "JournalEntryPage",
  "Macro", "RollTable", "Combat", "Folder", "User", "Cards", "Playlist", "Compendium"
]);

function extractDocTypeFromUuid(uuid) {
  if (!uuid) return null;
  for (const part of uuid.split(".")) {
    if (KNOWN_DOC_TYPES.has(part) && part !== "Compendium") return part;
  }
  return null;
}

function resolveUuid(uuid, relativeDoc) {
  let doc = null;
  try {
    // Pass `relative` so Foundry can resolve UUIDs that start with "." (e.g.
    // ".uNM2XCwHN8F7vHky" → sibling page within the same journal).
    doc = fromUuidSync(uuid, relativeDoc ? { relative: relativeDoc } : {});
  } catch (_) { /* unloaded compendium or malformed */ }
  // Manual fallback: fromUuidSync sometimes doesn't resolve relative ".id"
  // sibling-page references. Walk the journal context directly.
  if (!doc && uuid.startsWith(".") && relativeDoc) {
    const id = uuid.slice(1).split(".")[0];
    doc = relativeDoc.pages?.get?.(id)
      ?? relativeDoc.parent?.pages?.get?.(id)
      ?? null;
  }
  return doc;
}

function embedToMarkdown(uuid, displayText, relativeDoc, imageUrlMap, usedImgNames) {
  // If the embed target is (or has) an image, emit an inline image and register
  // the source for fetching into the zip. Otherwise fall back to a wikilink.
  const doc = resolveUuid(uuid, relativeDoc);
  const imageSrc = doc?.src || doc?.image?.src;
  if (imageSrc && imageUrlMap) {
    let zipPath = imageUrlMap.get(imageSrc);
    if (!zipPath) {
      zipPath = `images/${imageUrlToZipName(imageSrc, usedImgNames)}`;
      imageUrlMap.set(imageSrc, zipPath);
    }
    const altText = (displayText || doc?.image?.caption || doc?.name || "").trim();
    return `![${altText}](${encodeForMarkdownPath(zipPath)})`;
  }
  return uuidToReference(uuid, displayText, relativeDoc);
}

function uuidToReference(uuid, displayText, relativeDoc) {
  const display = (displayText || "").trim();
  const doc = resolveUuid(uuid, relativeDoc);

  const docType = doc?.documentName ?? extractDocTypeFromUuid(uuid);
  const name = (doc?.name ?? "").trim();

  if (docType && WIKILINKABLE_TYPES.has(docType)) {
    // The wikilink target must match the sanitized .md filename so Obsidian
    // can resolve the link (filenames have forbidden chars stripped, raw names
    // keep them — without sanitizing the target, a page like
    // "Capitolo 1: L'inizio" produces file "Capitolo 1- L'inizio.md" and a
    // dead wikilink "[[Capitolo 1: L'inizio]]").
    const target = sanitizeFilename(name) || sanitizeFilename(display) || uuid;
    // Alias preserves the human-readable text when it differs from the target:
    // explicit display wins; otherwise fall back to the original name.
    const alias = display || ((name && name !== target) ? name : "");
    if (alias && alias !== target) return `[[${target}|${alias}]]`;
    return `[[${target}]]`;
  }

  return `*${display || name || uuid}*`;
}

function addCustomTurndownRules(td, relativeDoc, imageUrlMap, usedImgNames) {
  // Safety net for HTML-rendered Foundry links (rare in raw text content).
  td.addRule("foundryContentLink", {
    filter: (node) => node.nodeName === "A" && node.classList?.contains?.("content-link"),
    replacement: (content, node) => {
      const uuid = node.getAttribute?.("data-uuid");
      if (!uuid) return content;
      // Use embedToMarkdown so HTML-rendered embeds of image pages also
      // get inlined as actual images.
      return embedToMarkdown(uuid, content, relativeDoc, imageUrlMap, usedImgNames);
    }
  });
  td.addRule("foundryInlineRoll", {
    filter: (node) => node.nodeName === "A" && (
      node.classList?.contains?.("inline-roll") ||
      node.classList?.contains?.("inline-request-roll")
    ),
    replacement: (content) => `*${content}*`
  });
  // Preserve <img> as standard markdown ![alt](src). The exporter pipeline
  // collects these URLs, fetches the image bytes, rewrites the paths to
  // images/<filename> and bundles everything into the zip.
  td.addRule("foundryImage", {
    filter: "img",
    replacement: (_content, node) => {
      const src = node.getAttribute?.("src");
      if (!src) return "";
      const alt = (node.getAttribute?.("alt") || "").trim();
      return `![${alt}](${src})`;
    }
  });
}

function postProcessMarkdown(md, relativeDoc, imageUrlMap, usedImgNames) {
  if (!md) return md;
  // Undo Turndown's bracket escaping so our regex patterns match cleanly.
  let out = md.replace(/\\([\[\]])/g, "$1");

  // @Embed[uuid optional-params]{display} or @Embed[uuid optional-params].
  // The bracket body can contain space-separated params (caption=false,
  // classes="right three", etc.); strip them and keep just the UUID.
  out = out.replace(/@Embed\[([^\]]+)\](?:\{([^}]+)\})?/g, (_m, body, display) => {
    const uuid = body.split(/\s+/)[0];
    return embedToMarkdown(uuid, display || "", relativeDoc, imageUrlMap, usedImgNames);
  });

  // @UUID[uuid optional-params]{display}
  out = out.replace(/@UUID\[([^\]]+)\]\{([^}]+)\}/g, (_m, body, display) => {
    const uuid = body.split(/\s+/)[0];
    return uuidToReference(uuid, display, relativeDoc);
  });
  // @UUID[uuid optional-params] (no display)
  out = out.replace(/@UUID\[([^\]]+)\]/g, (_m, body) => {
    const uuid = body.split(/\s+/)[0];
    return uuidToReference(uuid, "", relativeDoc);
  });

  // &Reference[k=v ...]{display}
  out = out.replace(/&[A-Z][a-zA-Z]+\[[^\]]+\]\{([^}]+)\}/g, "*$1*");
  // &Reference[k=v ...] (no display) — keep just the type name
  out = out.replace(/&([A-Z][a-zA-Z]+)\[[^\]]+\]/g, "*$1*");

  // Generic [[...]] handler: distinguishes rolls / dice / UUID embeds /
  // param-syntax / plain Obsidian-style wikilinks.
  out = out.replace(/\[\[([^\]\n]+)\]\](?:\{([^}]+)\})?/g, (_m, body, display) => {
    const trimmed = (body || "").trim();
    const disp = (display || "").trim();

    // Foundry slash command roll: [[/r 1d6+3]]{6 danni}, [[/save dc=15]]{...}
    if (trimmed.startsWith("/")) {
      if (disp) return `*${disp}*`;
      return `*${trimmed.replace(/^\/[a-z]+\s+/i, "").trim()}*`;
    }
    // Bare dice formula: [[1d6+3]], [[2d20kh1]]
    if (/^\d+d\d+/i.test(trimmed)) {
      return `*${disp || trimmed}*`;
    }
    // UUID-like embed/reference: [[JournalEntry.xxx]], [[Compendium.xxx]], [[Actor.xxx params]]
    if (/^(?:JournalEntryPage|JournalEntry|Compendium|Actor|Item|Scene|Macro|RollTable|Cards|Playlist)\./.test(trimmed)) {
      const uuid = trimmed.split(/\s+/)[0];
      return embedToMarkdown(uuid, disp, relativeDoc, imageUrlMap, usedImgNames);
    }
    // Foundry param-syntax (e.g. [[skill=prc dc=15]]): not user-readable, italicize
    if (trimmed.includes("=")) {
      return `*${disp || trimmed}*`;
    }
    // Plain Obsidian-style wikilink: pass through
    if (disp) return `[[${trimmed}|${disp}]]`;
    return `[[${trimmed}]]`;
  });

  return out;
}

function makeTurndownService(relativeDoc, imageUrlMap, usedImgNames) {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**"
  });
  addCustomTurndownRules(td, relativeDoc, imageUrlMap, usedImgNames);
  return td;
}

function getPageText(page) {
  // Any page that has HTML in text.content gets exported as text — covers
  // standard "text" pages and system-specific hybrids like dnd5e "map" pages
  // (description + area code), which Foundry stores the same way.
  return page?.text?.content || null;
}

function getPageImageSrc(page) {
  return page?.src || page?.image?.src || null;
}

function isExportablePage(page) {
  if (!page) return false;
  // Explicitly skip pdf/video — we can't render them as markdown.
  if (page.type === "pdf" || page.type === "video") return false;
  return Boolean(getPageText(page) || getPageImageSrc(page));
}

function buildPageMarkdown(page, td, relativeDoc, imageUrlMap, usedImgNames) {
  const title = (page.name || "Untitled").trim();
  const text = getPageText(page);
  const imageSrc = getPageImageSrc(page);

  let md = `# ${title}\n\n`;
  if (text) {
    md += postProcessMarkdown(td.turndown(text), relativeDoc, imageUrlMap, usedImgNames);
  }
  if (imageSrc) {
    const altText = (page.image?.caption || title).trim();
    md = md.trimEnd();
    if (md.length > `# ${title}`.length) md += "\n\n";
    md += `![${altText}](${imageSrc})\n`;
  }
  return md.replace(/\s+$/, "") + "\n";
}

// Forbidden chars on common filesystems + Obsidian. Replace with "-".
function sanitizeFilename(name) {
  if (!name) return "";
  return name
    .replace(/[\\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeFilename(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const m = name.match(/^(.*?)(\.[^.]+)?$/);
  const base = m?.[1] ?? name;
  const ext = m?.[2] ?? "";
  let i = 2;
  let candidate;
  do {
    candidate = `${base} (${i})${ext}`;
    i++;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function encodeForMarkdownPath(path) {
  // URL-encode each segment but keep "/" separators raw, so the path remains
  // a valid markdown link target (Obsidian and standard MD parsers won't accept
  // spaces or parens in unencoded form).
  return String(path).split("/").map(encodeURIComponent).join("/");
}

function imageUrlToZipName(url, used) {
  // Strip query/fragment, decode, take last segment, sanitize.
  const clean = String(url).split("?")[0].split("#")[0];
  let basename = "image";
  try {
    basename = decodeURIComponent(clean.split("/").filter(Boolean).pop() || "image");
  } catch (_) {
    basename = clean.split("/").filter(Boolean).pop() || "image";
  }
  basename = sanitizeFilename(basename) || "image";
  return dedupeFilename(basename, used);
}

// Rewrites ![alt](src) in markdown to ![alt](images/<sanitized>) and records
// the original URL in urlMap. Pure: returns the rewritten markdown.
function collectAndRewriteInlineImages(md, urlMap, usedImageNames) {
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    const trimmed = src.trim();
    if (!trimmed) return _m;
    // Already a zip-relative path written by an earlier pass (embedToMarkdown);
    // leave the match unchanged, otherwise we'd double-encode.
    if (trimmed.startsWith("images/") || trimmed.startsWith("images%2F")) return _m;
    let zipPath = urlMap.get(trimmed);
    if (!zipPath) {
      zipPath = `images/${imageUrlToZipName(trimmed, usedImageNames)}`;
      urlMap.set(trimmed, zipPath);
    }
    return `![${alt}](${encodeForMarkdownPath(zipPath)})`;
  });
}

async function fetchImageAsArrayBuffer(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.arrayBuffer();
  } catch (e) {
    console.warn(`${LOG_PREFIX} | failed to fetch image "${url}":`, e);
    return null;
  }
}

async function saveBlobToFile(blob, filename) {
  // Try the modern File System Access API (cleanest UX, suggested name preserved).
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "ZIP Archive",
          accept: { "application/zip": [".zip"] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if (e.name === "AbortError") return false; // user cancelled
      console.warn(`${LOG_PREFIX} | showSaveFilePicker failed, falling back:`, e);
    }
  }

  // Fallback: anchor download. The browser/Electron decides the location;
  // user-configured defaultDownloadFolder cannot be enforced from here.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

async function exportJournalToMarkdown(journal) {
  if (typeof TurndownService !== "function" || typeof JSZip !== "function") {
    ui.notifications?.error(`${MODULE_ID}: required libraries not loaded`);
    return;
  }

  const allPages = journal.pages.contents;
  const exportablePages = allPages.filter(isExportablePage);

  if (exportablePages.length === 0) {
    ui.notifications?.warn(game.i18n.localize("JSP.NotificationNoTextPages"));
    return;
  }

  ui.notifications?.info(game.i18n.localize("JSP.NotificationExportInProgress"));

  try {
    const zip = new JSZip();
    const usedMdNames = new Set();
    const usedImgNames = new Set();
    const imageUrlMap = new Map(); // original URL -> zip path (e.g. "images/foo.png")
    const td = makeTurndownService(journal, imageUrlMap, usedImgNames);
    const utf8 = new TextEncoder();
    let untitledIdx = 1;

    // Build markdown for every exportable page, collecting referenced images.
    for (const page of exportablePages) {
      const baseName = sanitizeFilename(page.name) || `Untitled Page (${untitledIdx++})`;
      const filename = dedupeFilename(`${baseName}.md`, usedMdNames);
      let md = buildPageMarkdown(page, td, journal, imageUrlMap, usedImgNames);
      md = collectAndRewriteInlineImages(md, imageUrlMap, usedImgNames);
      zip.file(filename, utf8.encode(md));
    }

    // Fetch all referenced images in parallel, add bytes to zip.
    const fetchTasks = Array.from(imageUrlMap.entries()).map(async ([url, zipPath]) => {
      const buf = await fetchImageAsArrayBuffer(url);
      if (buf) zip.file(zipPath, buf);
      return { url, ok: !!buf };
    });
    const fetchResults = await Promise.all(fetchTasks);
    const fetchedCount = fetchResults.filter(r => r.ok).length;
    const failedCount = fetchResults.length - fetchedCount;

    const blob = await zip.generateAsync({
      type: "blob",
      mimeType: "application/zip"
    });
    const zipName = `${sanitizeFilename(journal.name) || "Journal"}.zip`;

    await saveBlobToFile(blob, zipName);

    ui.notifications?.info(game.i18n.format("JSP.NotificationExportComplete", {
      exportedCount: exportablePages.length,
      totalCount: allPages.length,
      skippedCount: allPages.length - exportablePages.length,
      imageCount: fetchedCount,
      imageFailedCount: failedCount
    }));
  } catch (e) {
    console.error(`${LOG_PREFIX} | export failed:`, e);
    ui.notifications?.error(game.i18n.format("JSP.NotificationExportError", {
      error: e?.message ?? String(e)
    }));
  }
}

function buildExportContextMenuItem() {
  return {
    label: "JSP.ExportToMarkdown",
    icon: "fa-solid fa-file-arrow-down",
    visible: (...args) => canUserExport(getJournalFromContextArgs(args)),
    onClick: (...args) => {
      const journal = getJournalFromContextArgs(args);
      if (!journal) return;
      exportJournalToMarkdown(journal);
    }
  };
}

function wrapApplicationV2ContextMenu() {
  // Wrap ApplicationV2.prototype._createContextMenu (singular). When the sidebar
  // builds its journal entry context menu — once, at first render — we intercept
  // the handler and append our item to the menuItems array before ContextMenu
  // is constructed. Result: a single menu containing standard items + ours.
  const ApplicationV2 = foundry.applications?.api?.ApplicationV2;
  if (!ApplicationV2?.prototype?._createContextMenu) {
    console.warn(`${LOG_PREFIX} | ApplicationV2._createContextMenu not available, cannot wire menu`);
    return;
  }
  const original = ApplicationV2.prototype._createContextMenu;
  if (original.__jspWrapped) return;

  const wrapped = function(handler, selector, options) {
    const isJournalEntryMenu =
      this?.documentName === "JournalEntry" &&
      selector === ".directory-item[data-entry-id]";

    if (!isJournalEntryMenu) return original.call(this, handler, selector, options);

    const wrappedHandler = function() {
      const items = handler.call(this);
      items.push(buildExportContextMenuItem());
      return items;
    };
    return original.call(this, wrappedHandler, selector, options);
  };
  wrapped.__jspWrapped = true;
  ApplicationV2.prototype._createContextMenu = wrapped;
  console.log(`${LOG_PREFIX} | ApplicationV2._createContextMenu wrapped`);
}

Hooks.once("init", () => {
  console.log(`${LOG_PREFIX} | init`);

  // Must wrap before the sidebar's first render (which happens after init),
  // otherwise the ContextMenu instance is constructed without our item and
  // there is no clean way to retrofit it.
  wrapApplicationV2ContextMenu();

  game.settings.register(MODULE_ID, SETTING_MIN_ROLE, {
    name: "JSP.SettingExportMinimumRole",
    hint: "JSP.SettingExportMinimumRoleHint",
    scope: "world",
    config: true,
    type: Number,
    default: CONST.USER_ROLES.GAMEMASTER,
    choices: {
      [CONST.USER_ROLES.PLAYER]:     "JSP.RolePlayer",
      [CONST.USER_ROLES.TRUSTED]:    "JSP.RoleTrusted",
      [CONST.USER_ROLES.ASSISTANT]:  "JSP.RoleAssistant",
      [CONST.USER_ROLES.GAMEMASTER]: "JSP.RoleGamemaster"
    }
  });

  game.settings.register(MODULE_ID, SETTING_DOWNLOAD_FOLDER, {
    name: "JSP.SettingDefaultDownloadFolder",
    hint: "JSP.SettingDefaultDownloadFolderHint",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });
});

Hooks.once("ready", () => {
  console.log(`${LOG_PREFIX} | ready | TurndownService=${typeof TurndownService} JSZip=${typeof JSZip}`);
});

export { canUserExport, getDefaultDownloadFolder, MODULE_ID };
