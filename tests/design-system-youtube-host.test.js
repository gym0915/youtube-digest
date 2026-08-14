const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "content.js"), "utf8");
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(root, "tests/fixtures/youtube-host-actions-toast.fixture.json"),
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
    this.dataset = {};
    this.listeners = new Map();
    this.parentElement = null;
    this.style = {};
    this.isConnected = false;
    this._innerHTML = "";
    this.textContent = "";
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    if (value.includes("ytd-note-toast-copy")) {
      const copyLink = new FakeElement("a");
      copyLink.className = "ytd-note-toast-copy";
      copyLink.textContent = "🔗 Copy link";
      const copyStatus = new FakeElement("span");
      copyStatus.className = "ytd-note-toast-copy-status";
      this.appendChild(copyLink);
      this.appendChild(copyStatus);
    }
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
    const matches = this.querySelectorAll(selector);
    return matches[0] || null;
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

function createHarness({ clipboardWrite, sendMessage } = {}) {
  const documentListeners = new Map();
  const timeoutCallbacks = new Map();
  let nextTimerId = 1;
  const body = new FakeElement("body");
  const head = new FakeElement("head");
  const player = new FakeElement("div");
  const video = new FakeElement("video");
  video.currentTime = 73;
  body.appendChild(player);
  body.appendChild(video);

  const findById = (node, id) => {
    if (node.id === id && node.isConnected) return node;
    for (const child of node.children) {
      const match = findById(child, id);
      if (match) return match;
    }
    return null;
  };
  const document = {
    activeElement: null,
    body,
    head,
    readyState: "loading",
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
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
      return null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith("#")) return body.querySelectorAll(selector);
      return [];
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
        sendMessage: sendMessage || (async () => ({ success: true })),
      },
    },
    clearInterval() {},
    clearTimeout(timerId) {
      timeoutCallbacks.delete(timerId);
    },
    console: { error() {}, log() {} },
    document,
    navigator: { clipboard: { writeText: clipboardWrite || (async () => {}) } },
    setInterval() {
      return 1;
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
      location: { pathname: "/watch", search: "?v=video-1" },
    },
  });
  vm.runInContext(source, context);
  return {
    context,
    document,
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

function functionSource(name, nextName) {
  return source.slice(source.indexOf(`function ${name}`), source.indexOf(`function ${nextName}`));
}

test("DS-10 fixes the existing host controls to the approved visual and accessibility contract", () => {
  assert.equal(fixture.scenario, "DS-10");
  assert.deepEqual(fixture.viewports, ["1280x900", "1024x900"]);
  assert.deepEqual(fixture.hostActions, ["Digest", "Note", "Copy link"]);
  assert.deepEqual(fixture.noteStates, ["hidden", "visible", "saving", "saved", "error"]);
  assert.match(source, /<span class="ytd-digest-label">Digest<\/span>/);
  assert.match(source, /<span>Note<\/span>/);
  assert.match(source, />🔗 Copy link<\/a>/);
  assert.match(source, /#ytd-digest-button:active\s*\{[\s\S]*box-shadow: none/);
  assert.doesNotMatch(functionSource("createDigestButton", "injectDigestButton"), /scale\(/);
  assert.match(source, /#ytd-note-button\[data-note-state="saved"\][\s\S]*--sys-state-success/);
  assert.match(source, /#ytd-note-button\[data-note-state="error"\][\s\S]*--sys-state-error/);
  assert.match(source, /aria-live", "polite"/);
  assert.match(source, /aria-busy", String\(state === "saving"\)/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important/);
  assert.match(source, /width: min\(350px, calc\(100vw - 24px\)\)/);
});

test("DS-10 binds Note and Toast feedback to controlled save and Clipboard results", async () => {
  const saveGate = createDeferred();
  const note = {
    text: "A saved note.",
    timestamp: "1:10",
    timestampedUrl: "https://www.youtube.com/watch?v=video-1&t=70",
    videoTitle: "Fixture video",
  };
  const harness = createHarness({
    sendMessage: async (message) => {
      assert.equal(message.action, "saveNote");
      assert.equal(message.timestamp, 70);
      await saveGate.promise;
      return { success: true, note };
    },
  });
  harness.context.injectNoteButton();
  const noteButton = harness.document.getElementById("ytd-note-button");
  assert.equal(noteButton.getAttribute("aria-hidden"), "true");
  assert.equal(noteButton.tabIndex, -1);
  assert.equal(noteButton.style.pointerEvents, "none");

  harness.context.showNoteButton();
  assert.equal(noteButton.getAttribute("aria-hidden"), "false");
  assert.equal(noteButton.tabIndex, 0);
  const save = harness.context.saveCurrentNote();
  await Promise.resolve();
  assert.equal(noteButton.dataset.noteState, "saving");
  assert.equal(noteButton.disabled, true);
  assert.equal(noteButton.getAttribute("aria-busy"), "true");
  assert.equal(noteButton.tabIndex, -1);
  saveGate.resolve();
  await save;
  assert.equal(noteButton.dataset.noteState, "saved");
  assert.equal(noteButton.disabled, false);
  assert.match(noteButton.innerHTML, /✓/);

  const toast = harness.document.getElementById("ytd-note-toast");
  assert.ok(toast);
  const copyLink = toast.querySelector(".ytd-note-toast-copy");
  const copyStatus = toast.querySelector(".ytd-note-toast-copy-status");
  const copyGate = createDeferred();
  harness.context.navigator.clipboard.writeText = async (value) => {
    assert.equal(value, note.timestampedUrl);
    await copyGate.promise;
  };
  const copy = copyLink.listeners.get("click")({ preventDefault() {} });
  await Promise.resolve();
  assert.equal(copyLink.getAttribute("aria-disabled"), "true");
  assert.equal(copyLink.textContent, "Copying link…");
  copyGate.resolve();
  await copy;
  assert.equal(copyLink.textContent, "✓ Link copied");
  assert.equal(copyStatus.textContent, "Note link copied.");
  assert.equal(copyLink.getAttribute("aria-disabled"), null);

  const failure = createHarness({
    sendMessage: async () => ({ success: false, error: "storage failed" }),
    clipboardWrite: async () => {
      throw new Error("clipboard unavailable");
    },
  });
  failure.context.injectNoteButton();
  failure.context.showNoteButton();
  await failure.context.saveCurrentNote();
  const failedNote = failure.document.getElementById("ytd-note-button");
  assert.equal(failedNote.dataset.noteState, "error");
  assert.match(failedNote.innerHTML, /Could not save note\. Try again\./);
  assert.equal(failure.document.getElementById("ytd-note-toast"), null);

  failure.context.showNoteSavedToast(note);
  const failedToast = failure.document.getElementById("ytd-note-toast");
  const failedCopy = failedToast.querySelector(".ytd-note-toast-copy");
  const failedStatus = failedToast.querySelector(".ytd-note-toast-copy-status");
  await failedCopy.listeners.get("click")({ preventDefault() {} });
  assert.equal(failedCopy.textContent, "! Copy failed — try again");
  assert.match(failedStatus.textContent, /Try again or copy the link address manually/);
});

test("DS-10 restores the Note control and dismisses the toast after brief feedback", () => {
  assert.match(
    functionSource("saveCurrentNote", "showNoteSavedToast"),
    /function scheduleNoteButtonStateReset[\s\S]*setNoteButtonState\(noteButton, "idle"\)[\s\S]*}, 2000\);/,
  );
  assert.match(
    functionSource("showNoteSavedToast", "extractVideoInfo"),
    /ytdNoteToastDismissTimer = setTimeout\([\s\S]*toast\.remove\(\)[\s\S]*}, 5000\);/,
  );
  assert.match(functionSource("showNoteButton", "hideNoteButton"), /aria-hidden", "false"/);
  assert.match(functionSource("hideNoteButton", "getNoteButtonMarkup"), /aria-hidden", "true"/);
  assert.match(source, /existingToast\.remove\(\)/);
});

test("DS-10 automatically returns saved Note feedback to idle and removes its toast", async () => {
  const note = {
    text: "A saved note.",
    timestamp: "1:10",
    timestampedUrl: "https://www.youtube.com/watch?v=video-1&t=70",
    videoTitle: "Fixture video",
  };
  const harness = createHarness({
    sendMessage: async () => ({ success: true, note }),
  });
  harness.context.injectNoteButton();
  harness.context.showNoteButton();

  await harness.context.saveCurrentNote();
  const noteButton = harness.document.getElementById("ytd-note-button");
  assert.equal(noteButton.dataset.noteState, "saved");
  assert.ok(harness.document.getElementById("ytd-note-toast"));

  harness.flushTimeouts();
  assert.equal(noteButton.dataset.noteState, "idle");
  assert.equal(harness.document.getElementById("ytd-note-toast"), null);
});
