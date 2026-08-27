const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const i18n = require("../i18n.js");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "content.js"), "utf8");
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(root, "tests/fixtures/youtube-host-lifecycle-shortcut.fixture.json"),
    "utf8",
  ),
);

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.children = [];
    this.className = "";
    this.dataset = {};
    this.height = 36;
    this.id = "";
    this.inMetadata = false;
    this.inPrimary = false;
    this.isConnected = false;
    this.isContentEditable = false;
    this.listeners = new Map();
    this.parentElement = null;
    this.style = {};
    this.textContent = "";
    this.width = 100;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  getBoundingClientRect() {
    return { height: this.height, width: this.width };
  }

  closest(selector) {
    if (selector === "ytd-watch-metadata" && this.inMetadata) return this;
    if (selector === "#primary" && this.inPrimary) return this;
    return null;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || this.textContent;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  appendChild(child) {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    child.isConnected = true;
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parentElement = null;
    child.isConnected = false;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (
        (selector === "a" && child.tagName === "A") ||
        (selector.startsWith(".") && child.className === selector.slice(1)) ||
        (selector.startsWith("#") && child.id === selector.slice(1))
      ) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

function createHarness({ sendMessage } = {}) {
  const documentListeners = new Map();
  const listenerCounts = new Map();
  const timeoutCallbacks = new Map();
  let nextTimerId = 1;

  const body = new FakeElement("body");
  body.isConnected = true;
  const head = new FakeElement("head");
  head.isConnected = true;
  const player = new FakeElement("div");
  const video = new FakeElement("video");
  video.currentTime = 73;
  body.appendChild(player);
  body.appendChild(video);

  const actionRow = new FakeElement("div");
  actionRow.id = "actions-inner";
  actionRow.inMetadata = true;
  actionRow.inPrimary = true;
  const actionGroup = new FakeElement("div");
  actionGroup.id = "top-level-buttons-computed";
  actionGroup.inMetadata = true;
  actionGroup.inPrimary = true;
  actionRow.appendChild(actionGroup);
  body.appendChild(actionRow);

  const findById = (node, id) => {
    if (node.id === id && node.isConnected) return node;
    for (const child of node.children) {
      const match = findById(child, id);
      if (match) return match;
    }
    return null;
  };

  const location = { pathname: "/watch", search: "?v=video-1" };
  const document = {
    activeElement: null,
    body,
    head,
    readyState: "loading",
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
      listenerCounts.set(type, (listenerCounts.get(type) || 0) + 1);
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return findById(head, id) || findById(body, id);
    },
    querySelector(selector) {
      if (selector.includes("movie_player") || selector === ".html5-video-player") {
        return player;
      }
      if (selector === "video.html5-main-video") return video;
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      if (selector === "ytd-watch-metadata #actions-inner") return [actionRow];
      if (selector.includes("top-level-buttons-computed")) return [actionGroup];
      return body.querySelectorAll(selector);
    },
  };

  const context = vm.createContext({
    URLSearchParams,
    MutationObserver: class {
      observe() {}
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: sendMessage || (async () => ({ success: false })),
      },
    },
    clearInterval() {},
    clearTimeout(timerId) {
      timeoutCallbacks.delete(timerId);
    },
    console: { error() {}, log() {} },
    document,
    YTD_I18N: i18n,
    navigator: { clipboard: { writeText: async () => {} } },
    setInterval() {
      return nextTimerId++;
    },
    setTimeout(callback) {
      const timerId = nextTimerId++;
      timeoutCallbacks.set(timerId, callback);
      return timerId;
    },
    window: {
      addEventListener() {},
      getComputedStyle(element) {
        return {
          display: "flex",
          position: element === player ? "static" : "relative",
          visibility: "visible",
        };
      },
      location,
    },
  });

  vm.runInContext(source, context);
  return {
    actionGroup,
    context,
    document,
    documentListeners,
    listenerCounts,
    location,
    player,
    flushTimeouts() {
      while (timeoutCallbacks.size > 0) {
        const callbacks = Array.from(timeoutCallbacks.values());
        timeoutCallbacks.clear();
        callbacks.forEach((callback) => callback());
      }
    },
  };
}

function keyEvent(key) {
  return {
    key,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}

test("DS-11 keeps non-watch injection and editable n-key exemptions unchanged", () => {
  assert.equal(fixture.scenario, "DS-11");
  assert.deepEqual(fixture.contexts, [
    "watch",
    "non-watch",
    "input",
    "textarea",
    "contenteditable",
  ]);

  const saveGate = createDeferred();
  let saveRequests = 0;
  const harness = createHarness({
    sendMessage: async (message) => {
      saveRequests += 1;
      assert.equal(message.action, "saveNote");
      await saveGate.promise;
      return { success: false, error: "fixture pending" };
    },
  });
  harness.context.init();
  harness.context.init();
  assert.equal(harness.listenerCounts.get("keydown"), 1);

  const shortcut = keyEvent("n");
  harness.context.handleNoteKeyboardShortcut(shortcut);
  assert.equal(saveRequests, 1);
  assert.equal(shortcut.prevented, true);
  assert.equal(shortcut.stopped, true);

  for (const tagName of ["INPUT", "TEXTAREA"]) {
    const editable = new FakeElement(tagName.toLowerCase());
    harness.document.activeElement = editable;
    const event = keyEvent("N");
    harness.context.handleNoteKeyboardShortcut(event);
    assert.equal(saveRequests, 1, tagName);
    assert.equal(event.prevented, false, tagName);
    assert.equal(event.stopped, false, tagName);
  }

  const editableRegion = new FakeElement("div");
  editableRegion.isContentEditable = true;
  harness.document.activeElement = editableRegion;
  const contenteditableEvent = keyEvent("n");
  harness.context.handleNoteKeyboardShortcut(contenteditableEvent);
  assert.equal(saveRequests, 1);
  assert.equal(contenteditableEvent.prevented, false);
  assert.equal(contenteditableEvent.stopped, false);

  harness.document.activeElement = null;
  saveGate.resolve();
});

test("DS-11 never injects the existing controls on a non-watch page", () => {
  const harness = createHarness();
  harness.location.pathname = "/results";

  assert.equal(harness.context.injectDigestButton(), false);
  assert.equal(harness.context.injectNoteButton(), undefined);
  assert.equal(harness.document.querySelectorAll("#ytd-digest-button").length, 0);
  assert.equal(harness.document.querySelectorAll("#ytd-note-button").length, 0);

  const event = keyEvent("n");
  harness.context.handleNoteKeyboardShortcut(event);
  assert.equal(event.prevented, false);
  assert.equal(event.stopped, false);
});

test("DS-11 removes invalidated host feedback and re-adapts exactly one default control set", async () => {
  const saveGate = createDeferred();
  const savedNote = {
    text: "Old video note",
    timestamp: "1:10",
    timestampedUrl: "https://www.youtube.com/watch?v=video-1&t=70",
    videoTitle: "Old video",
  };
  const harness = createHarness({
    sendMessage: async () => {
      await saveGate.promise;
      return { success: true, note: savedNote };
    },
  });
  harness.context.init();

  const oldDigest = harness.document.getElementById("ytd-digest-button");
  const oldNote = harness.document.getElementById("ytd-note-button");
  assert.ok(oldDigest);
  assert.ok(oldNote);
  harness.context.showNoteButton();
  const save = harness.context.saveCurrentNote();
  await Promise.resolve();
  assert.equal(oldNote.dataset.noteState, "saving");

  const duplicateNote = harness.document.createElement("button");
  duplicateNote.id = "ytd-note-button";
  harness.document.body.appendChild(duplicateNote);
  for (const className of [
    "ytd-key-moment-markers",
    "ytd-note-toast",
    "ytd-note-toast",
  ]) {
    const stale = harness.document.createElement("div");
    if (className === "ytd-key-moment-markers") stale.className = className;
    else stale.id = className;
    harness.document.body.appendChild(stale);
  }

  harness.location.search = "?v=video-2";
  harness.documentListeners.get("yt-navigate-finish")();
  assert.equal(harness.document.querySelectorAll("#ytd-digest-button").length, 0);
  assert.equal(harness.document.querySelectorAll("#ytd-note-button").length, 0);
  assert.equal(harness.document.querySelectorAll("#ytd-note-toast").length, 0);
  assert.equal(
    harness.document.querySelectorAll(".ytd-key-moment-markers").length,
    0,
  );

  saveGate.resolve();
  await save;
  assert.equal(harness.document.querySelectorAll("#ytd-note-toast").length, 0);

  harness.flushTimeouts();
  const newDigest = harness.document.getElementById("ytd-digest-button");
  const newNote = harness.document.getElementById("ytd-note-button");
  assert.ok(newDigest);
  assert.ok(newNote);
  assert.notEqual(newDigest, oldDigest);
  assert.notEqual(newNote, oldNote);
  assert.equal(harness.document.querySelectorAll("#ytd-digest-button").length, 1);
  assert.equal(harness.document.querySelectorAll("#ytd-note-button").length, 1);
  assert.equal(newNote.dataset.noteState, "idle");
  assert.equal(newNote.getAttribute("aria-hidden"), "true");
  assert.equal(newNote.tabIndex, -1);
  assert.equal(harness.document.querySelectorAll("#ytd-note-toast").length, 0);
});
