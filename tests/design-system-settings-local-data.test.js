const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const options = require("../options.js");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const html = read("options.html");
const css = read("options.css");
const js = read("options.js");
const fixture = JSON.parse(
  read("tests/fixtures/settings-local-remix-data-operations.fixture.json"),
);

function createElement({ value = "", status = false } = {}) {
  const listeners = new Map();
  const statusText = status ? { textContent: "" } : null;
  return {
    attributes: {},
    dataset: {},
    disabled: false,
    hidden: true,
    selectionDirection: "none",
    selectionEnd: 0,
    selectionStart: 0,
    scrollLeft: 0,
    scrollTop: 0,
    value,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    getListener(name) {
      return listeners.get(name);
    },
    querySelector(selector) {
      return selector === ".status-message-text" ? statusText : null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createOptionsHarness({
  clipboardWrite = async () => {},
  confirm = () => true,
  initialStorage = {},
  storageFailures = {},
  storageGates = {},
} = {}) {
  const calls = [];
  const values = new Map(Object.entries(initialStorage));
  const elements = {
    aiApiKey: createElement({ value: "deepseek-key" }),
    aiApiKeyStatus: createElement({ status: true }),
    clearCacheBtn: createElement(),
    clearCacheStatus: createElement({ status: true }),
    clearNotesBtn: createElement(),
    clearNotesStatus: createElement({ status: true }),
    configurationStatus: createElement({ status: true }),
    copyCustomizationPromptBtn: createElement(),
    copyStatus: createElement({ status: true }),
    customizationPrompt: createElement({
      value: "Edited [PROVIDER] [MODEL] prompt with a complete long URL.",
    }),
    resetBtn: createElement(),
    resetStatus: createElement({ status: true }),
    saveSettingsBtn: createElement(),
    saveStatus: createElement({ status: true }),
    settingsForm: createElement(),
    supadataApiKey: createElement({ value: "supadata-key" }),
    supadataApiKeyStatus: createElement({ status: true }),
  };
  const documentListeners = new Map();
  const storage = {
    async clear() {
      calls.push(["clear"]);
      if (storageGates.clear) await storageGates.clear;
      if (storageFailures.clear) throw storageFailures.clear;
      values.clear();
    },
    async get(keys) {
      calls.push(["get", keys]);
      if (keys === null && storageGates.getAll) await storageGates.getAll;
      if (storageFailures.get) throw storageFailures.get;
      if (keys === null) return Object.fromEntries(values);
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested
          .filter((key) => values.has(key))
          .map((key) => [key, values.get(key)]),
      );
    },
    async remove(keys) {
      calls.push(["remove", keys]);
      if (keys === "ytd_notes" && storageGates.removeNotes) {
        await storageGates.removeNotes;
      }
      if (storageFailures.remove) throw storageFailures.remove;
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    async set(items) {
      calls.push(["set", items]);
      if (storageFailures.set) throw storageFailures.set;
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
  };
  const document = {
    documentElement: { lang: "en" },
    readyState: "loading",
    title: "",
    addEventListener(name, listener) {
      documentListeners.set(name, listener);
    },
    getElementById(id) {
      return elements[id];
    },
    querySelectorAll() {
      return [];
    },
  };
  const root = {
    YTD_SETTINGS: require("../settings.js"),
    chrome: { storage: { local: storage } },
    confirm,
    document,
    navigator: { clipboard: { writeText: clipboardWrite } },
  };

  options.initialize(root);
  return {
    calls,
    elements,
    values,
    async load() {
      await documentListeners.get("DOMContentLoaded")();
    },
  };
}

test("DS-09 fixes the narrow Local remix disclosure and complete editable prompt", () => {
  assert.deepEqual(fixture.viewports, ["600x900"]);
  assert.deepEqual(fixture.languages, ["en", "zh-CN"]);
  assert.match(fixture.longPrompt, /\[PROVIDER\].*\[MODEL\]/);
  assert.match(fixture.longPrompt, /https:\/\/example\.test\//);
  assert.match(
    fixture.longPrompt,
    /youtube-digest\.local-remix\.configuration\.example\.json/,
  );

  const detailsTag = html.match(
    /<details\b[^>]*class="card customization-card"[^>]*>/,
  );
  assert.ok(detailsTag, "Expected the existing native Local remix disclosure");
  assert.doesNotMatch(detailsTag[0], /\sopen(?:\s|=|>)/i);
  assert.match(html, /<summary class="customization-summary">/);
  assert.match(
    html,
    /<textarea id="customizationPrompt" rows="12" aria-describedby="customizationPromptReminder">[\s\S]*\[PROVIDER\][\s\S]*\[MODEL\][\s\S]*<\/textarea>/,
  );
  assert.doesNotMatch(
    html.match(/<textarea id="customizationPrompt"[^>]*>/)[0],
    /\sreadonly(?:\s|=|>)/,
  );
  assert.match(css, /textarea\s*\{[^}]*min-height:\s*190px;/);
  assert.match(css, /textarea\s*\{[^}]*resize:\s*vertical;/);
  assert.match(css, /textarea\s*\{[^}]*overflow-wrap:\s*normal;/);
  assert.match(css, /textarea\s*\{[^}]*word-break:\s*normal;/);
});

test("DS-09 maps copy and every local data result to a nearby semantic status", () => {
  for (const { key, target, state } of fixture.statusCases) {
    assert.deepEqual(options.getSettingsStatusDescriptor(key), { target, state });
  }

  for (const id of [
    "copyStatus",
    "clearCacheStatus",
    "clearNotesStatus",
    "resetStatus",
  ]) {
    assert.match(
      html,
      new RegExp(`id="${id}"[\\s\\S]*class="[^\"]*status-message[^\"]*"[\\s\\S]*role="status"[\\s\\S]*aria-live="polite"[\\s\\S]*aria-atomic="true"[\\s\\S]*hidden`),
    );
  }
  for (const [buttonId, statusId] of [
    ["copyCustomizationPromptBtn", "copyStatus"],
    ["clearCacheBtn", "clearCacheStatus"],
    ["clearNotesBtn", "clearNotesStatus"],
    ["resetBtn", "resetStatus"],
  ]) {
    assert.match(
      html,
      new RegExp(`id="${buttonId}"[\\s\\S]*aria-describedby="${statusId}"`),
    );
  }
  assert.match(css, /\.status-message\[data-state="success"\]/);
  assert.match(css, /\.status-message\[data-state="error"\]/);
  assert.match(
    css,
    /\.status-message-icon\s*\{[^}]*border:\s*1px solid currentColor;/,
  );
  assert.match(
    css,
    /\.status-message\[data-state="success"\][\s\S]*content:\s*"✓"/,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*\.data-actions,[\s\S]*\.data-operation[\s\S]*flex-direction:\s*column;/,
  );
});

test("DS-09 keeps copy, cache, notes, and Reset tied to their existing real operations", () => {
  const button = {
    disabled: false,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  options.setActionPending(button, true);
  assert.equal(button.disabled, true);
  assert.equal(button.attributes["aria-busy"], "true");
  options.setActionPending(button, false);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes["aria-busy"], "false");

  assert.match(js, /await copyPromptValue\([\s\S]*customizationPrompt\.value/);
  assert.match(
    js,
    /if \(isCopying\) return;[\s\S]*setActionPending\(copyCustomizationPromptBtn, true\);[\s\S]*finally \{[\s\S]*setActionPending\(copyCustomizationPromptBtn, false\);/,
  );
  assert.match(
    js,
    /Object\.keys\(all\)\.filter\(\(key\) =>[\s\S]*key\.startsWith\("digest_"\)/,
  );
  assert.match(
    js,
    /setStatus\(clearCacheStatus, "clearingCache"\);[\s\S]*await storage\.get\(null\)[\s\S]*await storage\.remove\(keys\)[\s\S]*setStatus\(clearCacheStatus, "clearedDigests", \{ count: keys\.length \}\)/,
  );
  assert.match(
    js,
    /await storage\.remove\("ytd_notes"\);[\s\S]*setStatus\(clearNotesStatus, "notesDeleted"\);/,
  );
  assert.doesNotMatch(js, /storage\.get\("ytd_notes"\)/);
  assert.match(
    js,
    /const confirmed = root\.confirm\([\s\S]*if \(!confirmed\) return;[\s\S]*setStatus\(resetStatus, "resettingData"\);[\s\S]*await storage\.clear\(\);[\s\S]*await persistPreferredLanguage\(storage, currentLanguage\);[\s\S]*await loadSettings\(\);[\s\S]*setStatus\(resetStatus, "allDataDeleted"\);/,
  );
  assert.match(js, /clearCacheFailed[\s\S]*deleteNotesFailed[\s\S]*resetFailed/);
  assert.doesNotMatch(js, /setTimeout\s*\(/);
});

test("DS-09 drives controlled clipboard and storage results without a browser", async () => {
  const writes = [];
  const copyGate = createDeferred();
  const success = createOptionsHarness({
    clipboardWrite: async (value) => {
      writes.push(value);
      await copyGate.promise;
    },
    initialStorage: {
      digest_first: { transcript: "first" },
      digest_second: { transcript: "second" },
      keep_me: "unchanged",
      ytd_notes: [{ id: "note-1" }],
      ytd_note_translations: { "note:1": { text: "\u7b14\u8bb0\u8bd1\u6587" } },
      ytd_video_cache_index: { version: 1, entries: {} },
      ytd_options_language: "en",
    },
  });
  await success.load();

  const copyAction = success.elements.copyCustomizationPromptBtn.getListener("click")();
  await Promise.resolve();
  assert.equal(success.elements.copyCustomizationPromptBtn.disabled, true);
  assert.equal(success.elements.copyCustomizationPromptBtn.attributes["aria-busy"], "true");
  assert.equal(success.elements.copyStatus.dataset.state, "loading");
  assert.equal(success.elements.customizationPrompt.disabled, false);
  assert.equal(success.elements.clearCacheBtn.disabled, false);
  assert.equal(success.elements.clearNotesBtn.disabled, false);
  assert.equal(success.elements.resetBtn.disabled, false);
  copyGate.resolve();
  await copyAction;
  assert.deepEqual(writes, [success.elements.customizationPrompt.value]);
  assert.equal(success.elements.customizationPrompt.disabled, false);
  assert.equal(success.elements.customizationPrompt.attributes.readonly, undefined);
  assert.equal(success.elements.copyCustomizationPromptBtn.disabled, false);
  assert.equal(success.elements.copyStatus.dataset.state, "success");
  assert.equal(success.elements.copyStatus.querySelector(".status-message-text").textContent, "Edited prompt copied.");

  await success.elements.clearCacheBtn.getListener("click")();
  assert.equal(success.values.has("digest_first"), false);
  assert.equal(success.values.has("digest_second"), false);
  assert.equal(success.values.has("ytd_video_cache_index"), false);
  assert.equal(success.values.get("keep_me"), "unchanged");
  assert.deepEqual(success.values.get("ytd_note_translations"), {
    "note:1": { text: "\u7b14\u8bb0\u8bd1\u6587" },
  });
  assert.equal(success.elements.clearCacheStatus.dataset.state, "success");
  assert.equal(success.elements.clearCacheStatus.querySelector(".status-message-text").textContent, "Cleared 2 cached digests.");

  await success.elements.clearNotesBtn.getListener("click")();
  assert.equal(success.values.has("ytd_notes"), false);
  assert.equal(success.elements.clearNotesStatus.dataset.state, "success");
  assert.equal(success.elements.clearNotesStatus.querySelector(".status-message-text").textContent, "Deleted all saved notes.");

  await success.elements.resetBtn.getListener("click")();
  assert.deepEqual([...success.values.entries()], [["ytd_options_language", "en"]]);
  assert.equal(success.elements.resetStatus.dataset.state, "success");
  assert.equal(success.elements.resetStatus.querySelector(".status-message-text").textContent, "All YouTube Digest data was deleted.");
  const resetStart = success.calls.findLastIndex(
    ([operation]) => operation === "clear",
  );
  assert.deepEqual(
    success.calls.slice(resetStart).map(([operation]) => operation),
    ["clear", "set", "get"],
  );

  const cacheGate = createDeferred();
  const cachePending = createOptionsHarness({
    initialStorage: { digest_pending: { transcript: "pending" } },
    storageGates: { getAll: cacheGate.promise },
  });
  await cachePending.load();
  const cacheAction = cachePending.elements.clearCacheBtn.getListener("click")();
  await Promise.resolve();
  assert.equal(cachePending.elements.clearCacheBtn.disabled, true);
  assert.equal(cachePending.elements.clearCacheBtn.attributes["aria-busy"], "true");
  assert.equal(cachePending.elements.clearCacheStatus.dataset.state, "loading");
  assert.equal(cachePending.elements.copyCustomizationPromptBtn.disabled, false);
  assert.equal(cachePending.elements.clearNotesBtn.disabled, false);
  assert.equal(cachePending.elements.resetBtn.disabled, false);
  cacheGate.resolve();
  await cacheAction;
  assert.equal(cachePending.elements.clearCacheBtn.disabled, false);
  assert.equal(cachePending.elements.clearCacheStatus.dataset.state, "success");

  const notesGate = createDeferred();
  const notesPending = createOptionsHarness({
    initialStorage: { ytd_notes: [{ id: "pending-note" }] },
    storageGates: { removeNotes: notesGate.promise },
  });
  await notesPending.load();
  const notesAction = notesPending.elements.clearNotesBtn.getListener("click")();
  await Promise.resolve();
  assert.equal(notesPending.elements.clearNotesBtn.disabled, true);
  assert.equal(notesPending.elements.clearNotesBtn.attributes["aria-busy"], "true");
  assert.equal(notesPending.elements.clearNotesStatus.dataset.state, "loading");
  assert.equal(notesPending.elements.copyCustomizationPromptBtn.disabled, false);
  assert.equal(notesPending.elements.clearCacheBtn.disabled, false);
  assert.equal(notesPending.elements.resetBtn.disabled, false);
  notesGate.resolve();
  await notesAction;
  assert.equal(notesPending.elements.clearNotesBtn.disabled, false);
  assert.equal(notesPending.elements.clearNotesStatus.dataset.state, "success");

  const resetGate = createDeferred();
  const resetPending = createOptionsHarness({
    storageGates: { clear: resetGate.promise },
  });
  await resetPending.load();
  const resetAction = resetPending.elements.resetBtn.getListener("click")();
  await Promise.resolve();
  assert.equal(resetPending.elements.resetBtn.disabled, true);
  assert.equal(resetPending.elements.resetBtn.attributes["aria-busy"], "true");
  assert.equal(resetPending.elements.resetStatus.dataset.state, "loading");
  assert.equal(resetPending.elements.copyCustomizationPromptBtn.disabled, false);
  assert.equal(resetPending.elements.clearCacheBtn.disabled, false);
  assert.equal(resetPending.elements.clearNotesBtn.disabled, false);
  resetGate.resolve();
  await resetAction;
  assert.equal(resetPending.elements.resetBtn.disabled, false);
  assert.equal(resetPending.elements.resetStatus.dataset.state, "success");

  const copyFailure = createOptionsHarness({
    clipboardWrite: async () => {
      throw new Error("clipboard unavailable");
    },
  });
  await copyFailure.load();
  await copyFailure.elements.copyCustomizationPromptBtn.getListener("click")();
  assert.equal(copyFailure.elements.copyCustomizationPromptBtn.disabled, false);
  assert.equal(copyFailure.elements.copyStatus.dataset.state, "error");
  assert.match(
    copyFailure.elements.copyStatus.querySelector(".status-message-text").textContent,
    /Select the prompt text and copy it manually/,
  );

  const cacheFailure = createOptionsHarness({
    storageFailures: { get: new Error("storage read failed") },
  });
  await cacheFailure.load();
  await cacheFailure.elements.clearCacheBtn.getListener("click")();
  assert.equal(cacheFailure.elements.clearCacheBtn.disabled, false);
  assert.equal(cacheFailure.elements.clearCacheStatus.dataset.state, "error");

  const notesFailure = createOptionsHarness({
    storageFailures: { remove: new Error("storage remove failed") },
  });
  await notesFailure.load();
  await notesFailure.elements.clearNotesBtn.getListener("click")();
  assert.equal(notesFailure.elements.clearNotesBtn.disabled, false);
  assert.equal(notesFailure.elements.clearNotesStatus.dataset.state, "error");

  const resetCancelled = createOptionsHarness({ confirm: () => false });
  await resetCancelled.load();
  await resetCancelled.elements.resetBtn.getListener("click")();
  assert.equal(resetCancelled.elements.resetStatus.hidden, true);
  assert.equal(resetCancelled.calls.some(([operation]) => operation === "clear"), false);

  const resetFailure = createOptionsHarness({
    storageFailures: { clear: new Error("storage clear failed") },
  });
  await resetFailure.load();
  await resetFailure.elements.resetBtn.getListener("click")();
  assert.equal(resetFailure.elements.resetBtn.disabled, false);
  assert.equal(resetFailure.elements.resetStatus.dataset.state, "error");
});
