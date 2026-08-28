const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const i18n = require("../i18n.js");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadSidepanelHelpers({
  sendMessage = () => Promise.resolve({}),
  setTimeoutImpl = () => 0,
  clearTimeoutImpl = () => {},
  storageLocal = { get: async () => ({}), set: async () => {} },
} = {}) {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    setInterval() {},
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    window: { getSelection: () => null, close() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => {
        let value = "";
        return {
          set textContent(text) {
            value = String(text);
          },
          get innerHTML() {
            return value
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('"', "&quot;");
          },
        };
      },
    },
    chrome: {
      runtime: { onMessage: listeners, sendMessage },
      storage: { local: storageLocal, onChanged: listeners },
      windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
    YTD_SETTINGS: {},
    YTD_I18N: i18n,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("sidepanel.js"), sandbox);
  return sandbox.__YTD_TRANSCRIPT_TESTING__;
}

function loadBackgroundHelpers({
  settings = {
    provider: "deepseek",
    aiApiKey: "test-key",
    aiBaseUrl: "https://api.deepseek.com",
    aiModel: "deepseek-v4-flash",
  },
  fetchImpl = fetch,
  setTimeoutImpl = () => 0,
  clearTimeoutImpl = () => {},
} = {}) {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    fetch: fetchImpl,
    AbortController,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    importScripts() {},
    chrome: {
      storage: {
        onChanged: listeners,
        local: {
          setAccessLevel: () => Promise.resolve(),
          get: async () => ({ ytd_settings: settings }),
        },
      },
      action: { onClicked: listeners },
      sidePanel: {
        setPanelBehavior() {},
        setOptions: () => Promise.resolve(),
      },
      runtime: {
        onInstalled: listeners,
        onMessage: listeners,
        openOptionsPage() {},
        getURL: (resourcePath) => `chrome-extension://test/${resourcePath}`,
      },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
    YTD_SETTINGS: {
      STORAGE_KEY: "ytd_settings",
      normalize: (value) => value,
      chatCompletionsUrl: (baseUrl) => `${baseUrl}/chat/completions`,
    },
    YTD_I18N: i18n,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("background.js"), sandbox);
  return sandbox.__YTD_TRANSLATION_TESTING__;
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay, active: true });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.active = false;
    },
    fireActive(delay) {
      const match = [...timers.entries()].find(
        ([, timer]) => timer.active && timer.delay === delay,
      );
      assert.ok(match, `Expected an active ${delay}ms timer`);
      match[1].active = false;
      match[1].callback();
    },
    activeCount(delay) {
      return [...timers.values()].filter(
        (timer) => timer.active && timer.delay === delay,
      ).length;
    },
    createdCount(delay) {
      return [...timers.values()].filter((timer) => timer.delay === delay).length;
    },
  };
}

function streamingResponse(chunks, { ok = true, status = 200 } = {}) {
  let index = 0;
  return {
    ok,
    status,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true };
            return { done: false, value: chunks[index++] };
          },
          async cancel() {},
        };
      },
    },
  };
}

const encode = (value) => new TextEncoder().encode(value);
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("Transcript header exposes and wires Original, Chinese, and bilingual modes", () => {
  const html = read("sidepanel.html");
  const js = read("sidepanel.js");
  assert.match(html, /data-transcript-mode="original"[\s\S]*data-i18n="transcript\.modeOriginal"/);
  assert.match(html, /data-transcript-mode="zh"[\s\S]*data-i18n="transcript\.modeChinese"/);
  assert.match(html, /data-transcript-mode="bilingual"[\s\S]*data-i18n="transcript\.modeBilingual"/);
  assert.match(js, /handleTranscriptModeChange\(button\.dataset\.transcriptMode\)/);
  assert.match(js, /contentType: "transcriptBatch"/);
  assert.doesNotMatch(js, /English \+ Chinese/);
  assert.match(js, /t\("transcript\.originalWithLanguage", \{ language \}\)/);
});

test("Switching videos resets the panel to the original transcript", () => {
  const js = read("sidepanel.js");

  assert.match(
    js,
    /function resetContentViewForNewVideo\(\)[\s\S]*currentTranscriptMode = "original";[\s\S]*setTranscriptModeButtons\(currentTranscriptMode\);[\s\S]*switchTab\("transcript"\);/,
  );
  assert.match(
    js,
    /if \(videoId !== currentVideoId\) \{\s*resetContentViewForNewVideo\(\);/,
  );
});

test("Content controls sit below the title and above the global tab navigation", () => {
  const html = read("sidepanel.html");
  const css = read("sidepanel.css");
  const js = read("sidepanel.js");
  const toolbarIndex = html.indexOf('id="transcriptToolbar"');
  const tabsIndex = html.indexOf('id="tabsNav"');
  const contentIndex = html.indexOf('id="contentArea"');

  assert.ok(toolbarIndex > -1, "expected a dedicated content toolbar");
  assert.ok(
    toolbarIndex < tabsIndex && tabsIndex < contentIndex,
    "the content toolbar must sit above the tabs in the non-scrolling header",
  );
  assert.match(
    css,
    /\.transcript-toolbar\s*\{[^}]*display:\s*flex;[^}]*padding:\s*var\(--sys-layout-inline-gap\) 0/,
  );
  assert.match(css, /\.tabs\s*\{[^}]*margin-top:\s*0;/);
  assert.match(
    css,
    /\.transcript-toolbar\[hidden\]\s*\{[^}]*display:\s*none;/,
  );
  assert.doesNotMatch(css, /\.transcript-section-header\s*\{[^}]*position:\s*sticky;/);
  assert.match(
    js,
    /function setContentToolbarVisibility\(visible\)[\s\S]*?toolbar\.hidden = !visible;/,
  );
  assert.match(
    js,
    /function switchTab\(tabName\)[\s\S]*?setContentToolbarVisibility\(true\);/,
  );
  assert.match(
    js,
    /function showState\(state\)[\s\S]*?setContentToolbarVisibility\(state === "results"\);/,
  );
});

test("Transcript copy and export actions sit beside the transcript source", () => {
  const html = read("sidepanel.html");
  const toolbarStart = html.indexOf('id="transcriptToolbar"');
  const tabsStart = html.indexOf('id="tabsNav"');
  const sourceStart = html.indexOf('id="transcriptSourceBadge"');
  const copyStart = html.indexOf('id="copyTranscriptBtn"');
  const exportStart = html.indexOf('id="exportTranscriptBtn"');

  assert.ok(
    toolbarStart < tabsStart && tabsStart < sourceStart,
    "the transcript source belongs below the global header controls",
  );
  assert.ok(
    sourceStart < copyStart && copyStart < exportStart,
    "copy and export actions must follow the transcript source in its row",
  );
  assert.equal(
    html.slice(toolbarStart, tabsStart).includes("copyTranscriptBtn"),
    false,
    "global language controls must not contain transcript-only actions",
  );
  assert.match(
    html.slice(html.lastIndexOf("transcript-source-row", sourceStart), exportStart),
    /transcript-source-row[\s\S]*transcript-actions[\s\S]*copyTranscriptBtn/,
  );
});

test("semantic segmentation rebuilds sentences across caption boundaries", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const segments = groupTranscriptEntries(
    [
      { start: 0, text: "Caption boundaries should" },
      { start: 2, text: "not break a complete sentence." },
      { start: 5, text: "The next thought also" },
      { start: 7, text: "stays together!" },
    ],
    { minChars: 1, idealChars: 100, maxChars: 320, maxSeconds: 20 },
  );
  assert.equal(segments.length, 2);
  assert.equal(
    segments[0].text,
    "Caption boundaries should not break a complete sentence.",
  );
  assert.equal(segments[0].start, 0);
  assert.equal(segments[1].text, "The next thought also stays together!");
  assert.equal(segments[1].start, 5);
});

test("a huge raw Supadata entry is split into seekable bounded segments", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const text = Array.from({ length: 900 }, (_, index) => `word${index}`).join(" ");
  const segments = groupTranscriptEntries([
    { start: 12, duration: 90, text },
  ]);
  assert.ok(segments.length > 8);
  assert.ok(segments.every((segment) => segment.text.length <= 384));
  assert.equal(segments[0].start, 12);
  assert.ok(segments.at(-1).start > segments[0].start);
  assert.ok(segments.every((segment) => /^segment-\d+-\d+$/.test(segment.id)));
});

test("Chinese sentence and clause punctuation creates semantic guardrails", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const segments = groupTranscriptEntries(
    [
      { start: 0, text: "这是一个被字幕切开的" },
      { start: 2, text: "完整句子。这是第二个想法，" },
      { start: 5, text: "也应该保持语义完整！" },
    ],
    { minChars: 1, idealChars: 100, maxChars: 320, maxSeconds: 20 },
  );
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "这是一个被字幕切开的完整句子。");
  assert.equal(segments[1].text, "这是第二个想法，也应该保持语义完整！");
});

test("structured translation batches align by stable ID and expose missing fallback", () => {
  const sidepanel = loadSidepanelHelpers();
  const background = loadBackgroundHelpers();
  const source = [
    { id: "segment-0-0", text: "A complete first sentence." },
    { id: "segment-1-5000", text: "A complete second sentence." },
  ];
  assert.deepEqual(
    JSON.parse(JSON.stringify(background.validateTranscriptBatchRequest({ segments: source }))),
    source,
  );

  const normalized = background.normalizeTranslatedSegmentBatch(
    {
      segments: [
        { id: "unknown", text: "\u5ffd\u7565" },
        { id: "segment-1-5000", text: "\u7b2c\u4e8c\u4e2a\u5b8c\u6574\u53e5\u5b50\u3002" },
      ],
    },
    source,
  );
  const aligned = sidepanel.alignTranslatedSegmentBatch(
    source,
    normalized.segments,
  );
  assert.equal(aligned[0].id, source[0].id);
  assert.equal(aligned[0].text, "");
  assert.match(aligned[0].error, /unavailable/i);
  assert.equal(aligned[1].text, "\u7b2c\u4e8c\u4e2a\u5b8c\u6574\u53e5\u5b50\u3002");
});

test("Chinese and bilingual modes share one target cache and in-flight request", async () => {
  let resolveRequest;
  const requests = [];
  const sidepanel = loadSidepanelHelpers({
    sendMessage: (message) => {
      requests.push(message);
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
  });
  const source = [{ id: "segment-0-0", text: "Original sentence." }];

  const first = sidepanel.getTranscriptTranslationPromises(
    "video-1",
    source,
    "Video",
  );
  const second = sidepanel.getTranscriptTranslationPromises(
    "video-1",
    source,
    "Video",
  );

  assert.equal(requests.length, 1);
  assert.match(
    sidepanel.transcriptTranslationCacheKeyForVideo("video-1", source[0]),
    /^video:video-1:zh:transcriptBatch:segment-0-0:[0-9a-f]+:v2$/,
  );

  resolveRequest({
    success: true,
    translatedContent: {
      segments: [{ id: "segment-0-0", text: "\u4e2d\u6587\u8bd1\u6587\u3002" }],
    },
  });
  const [firstResult] = await Promise.all(first);
  const [secondResult] = await Promise.all(second);
  assert.equal(firstResult.text, "\u4e2d\u6587\u8bd1\u6587\u3002");
  assert.equal(secondResult.text, "\u4e2d\u6587\u8bd1\u6587\u3002");
});

test("content translation keys isolate surfaces and source revisions", () => {
  const sidepanel = loadSidepanelHelpers();
  const transcript = sidepanel.createContentTranslationItem({
    videoId: "video-1",
    contentType: "transcriptBatch",
    id: "segment-0-0",
    text: "Original sentence.",
  });
  const overview = sidepanel.createContentTranslationItem({
    videoId: "video-1",
    contentType: "overviewBatch",
    id: "quote-0-0",
    text: "Original sentence.",
  });
  const revised = sidepanel.createContentTranslationItem({
    videoId: "video-1",
    contentType: "overviewBatch",
    id: "quote-0-0",
    text: "Revised source sentence.",
  });

  assert.match(
    sidepanel.getContentTranslationDescriptor(transcript).key,
    /^video:video-1:zh:transcriptBatch:segment-0-0:[0-9a-f]+:v2$/,
  );
  assert.notEqual(
    sidepanel.getContentTranslationDescriptor(transcript).key,
    sidepanel.getContentTranslationDescriptor(overview).key,
  );
  assert.notEqual(
    sidepanel.getContentTranslationDescriptor(overview).key,
    sidepanel.getContentTranslationDescriptor(revised).key,
  );
});

test("content translation renderer keeps bilingual content stacked and avoids duplicate Chinese", () => {
  const sidepanel = loadSidepanelHelpers();
  const item = sidepanel.createContentTranslationItem({
    videoId: "video-1",
    contentType: "notesBatch",
    id: "note_1",
    text: "Original note.",
  });
  const chinese = sidepanel.renderContentTranslationMarkup(
    item,
    "zh",
    "\u4e2d\u6587\u7b14\u8bb0\u3002",
    "",
  );
  const bilingual = sidepanel.renderContentTranslationMarkup(
    item,
    "bilingual",
    "\u4e2d\u6587\u7b14\u8bb0\u3002",
    "",
  );
  const alreadyChinese = sidepanel.renderContentTranslationMarkup(
    { ...item, text: "\u8fd9\u662f\u4e2d\u6587\u3002" },
    "bilingual",
    "\u8fd9\u662f\u4e2d\u6587\u3002",
    "",
  );

  assert.doesNotMatch(chinese, /Original note/);
  assert.match(bilingual, /content-original/);
  assert.match(bilingual, /content-translation/);
  assert.doesNotMatch(alreadyChinese, /content-translation/);
});

test("translation cache writes use the captured video instead of the current tab", async () => {
  const values = new Map([
    [
      "digest_old-video",
      {
        transcript: [{ start: 0, text: "Original sentence." }],
        paragraphCache: {},
        timestamp: 1,
      },
    ],
  ]);
  const sidepanel = loadSidepanelHelpers({
    storageLocal: {
      get: async (key) => {
        if (key === null) return Object.fromEntries(values);
        const keys = Array.isArray(key) ? key : [key];
        return Object.fromEntries(
          keys.filter((item) => values.has(item)).map((item) => [item, values.get(item)]),
        );
      },
      set: async (items) => {
        Object.entries(items).forEach(([key, value]) => values.set(key, value));
      },
      remove: async (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => values.delete(key));
      },
    },
  });

  await sidepanel.persistTranscriptTranslations("old-video", [
    { key: "old-video:zh:semantic:segment-0-0", text: "\u65e7\u89c6\u9891\u8bd1\u6587" },
  ]);

  assert.equal(
    values.get("digest_old-video").paragraphCache[
      "old-video:zh:semantic:segment-0-0"
    ],
    "\u65e7\u89c6\u9891\u8bd1\u6587",
  );
  assert.ok(values.get("ytd_video_cache_index"));
});

test("video cache evicts whole least-recently-used records within its byte budget", () => {
  const sidepanel = loadSidepanelHelpers();
  const entries = {
    oldest: { byteSize: 3 * 1024 * 1024, lastAccessedAt: 10 },
    recent: { byteSize: 2 * 1024 * 1024, lastAccessedAt: 20 },
    current: { byteSize: 1 * 1024 * 1024, lastAccessedAt: 30 },
  };

  assert.deepEqual(
    Array.from(
      sidepanel.selectVideoCacheEvictions(
        entries,
        "current",
        5 * 1024 * 1024,
      ),
    ),
    ["oldest"],
  );
  assert.equal(sidepanel.VIDEO_CACHE_BUDGET_BYTES, 8 * 1024 * 1024);
  assert.equal(
    sidepanel.selectVideoCacheEvictions(
      entries,
      "current",
      sidepanel.VIDEO_CACHE_BUDGET_BYTES + 1,
    ),
    null,
  );
});

test("legacy video caches migrate their timestamp into LRU metadata without deletion", () => {
  const sidepanel = loadSidepanelHelpers();
  const index = sidepanel.buildVideoCacheIndex({
    digest_legacy: { transcript: [], timestamp: 1234 },
    ytd_notes: [{ id: "note-1" }],
  });

  assert.deepEqual(index.entries.legacy.lastAccessedAt, 1234);
  assert.ok(index.entries.legacy.byteSize > 0);
  assert.equal(index.entries.notes, undefined);
});

test("translation scheduling is visible-window only and pauses unsent work off-tab", () => {
  const js = read("sidepanel.js");
  assert.match(js, /rootMargin: "120px 0px"/);
  assert.doesNotMatch(js, /if \(index < 3\) enqueue\(index\)/);
  assert.match(js, /if \(!eligible\.has\(index\)\) continue;/);
  assert.match(js, /activeTranslationQueue = \{ enqueue, stop \}/);
  assert.match(js, /stopTranscriptTranslationSession\(\);[\s\S]*stopPlaybackTracking\(\);/);
});

test("switching from a translated tab to Original refreshes Overview and Notes", () => {
  const js = read("sidepanel.js");
  const switchTabSource = js.slice(
    js.indexOf("function switchTab"),
    js.indexOf("function renderOverviewStatus"),
  );
  const activeSurfaceSource = js.slice(
    js.indexOf("async function translateActiveContentSurface"),
    js.indexOf("/**\n * Renders immediately, translates the current visible window"),
  );

  assert.match(
    switchTabSource,
    /if \(tabName !== "transcript"\) \{\s*translateActiveContentSurface\(\);\s*\}/,
  );
  assert.match(
    activeSurfaceSource,
    /if \(currentTranscriptMode === "original"\)[\s\S]*renderAnalysisResults\(currentAnalysis\)/,
  );
  assert.match(
    activeSurfaceSource,
    /if \(currentTranscriptMode === "original"\)[\s\S]*renderNotes\(renderedNotes, renderedNotesFilter\)/,
  );
});

test("translated-only omits English while bilingual renders aligned English and Chinese", () => {
  const { renderTranscriptSegmentContent } = loadSidepanelHelpers();
  const segment = { id: "segment-0-0", text: "Original English sentence." };
  const translatedOnly = renderTranscriptSegmentContent(
    segment,
    "zh",
    "\u4e2d\u6587\u8bd1\u6587\u3002",
    "",
  );
  const bilingual = renderTranscriptSegmentContent(
    segment,
    "bilingual",
    "\u4e2d\u6587\u8bd1\u6587\u3002",
    "",
  );
  assert.doesNotMatch(translatedOnly, /Original English sentence/);
  assert.match(translatedOnly, /\u4e2d\u6587\u8bd1\u6587/);
  assert.match(bilingual, /transcript-original/);
  assert.match(bilingual, /Original English sentence/);
  assert.match(bilingual, /\u4e2d\u6587\u8bd1\u6587/);
});

test("subtitle formatting tags render in original and translated segment text", () => {
  const { renderTranscriptSegmentContent } = loadSidepanelHelpers();
  const html = renderTranscriptSegmentContent(
    {
      id: "segment-0-0",
      text: "Think <i>deeply</i>, <b>carefully</b>, and <u>clearly</u>.<br>Next line.",
    },
    "bilingual",
    "\u5b57\u5730<i>\u601d\u8003</i>\u7684\u3002<strong>\u91cd\u70b9</strong>",
    "",
  );

  assert.match(html, /Think <i>deeply<\/i>/);
  assert.match(html, /<b>carefully<\/b>/);
  assert.match(html, /<u>clearly<\/u>\.<br>Next line/);
  assert.match(html, /\u5b57\u5730<i>\u601d\u8003<\/i>\u7684\u3002<strong>\u91cd\u70b9<\/strong>/);
});

test("subtitle markup renderer keeps attributed and arbitrary HTML escaped", () => {
  const { renderSubtitleInlineMarkup } = loadSidepanelHelpers();
  const html = renderSubtitleInlineMarkup(
    '<img src=x onerror="alert(1)"><i onclick="alert(2)">unsafe</i><script>alert(3)</script>',
  );

  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;i onclick=&quot;alert\(2\)&quot;&gt;unsafe<\/i>/);
  assert.match(html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img\b|<i\s+onclick|<script\b/);
});

test("background rejects unsupported language fallthrough and malformed batches", () => {
  const source = read("background.js");
  const { validateTranscriptBatchRequest } = loadBackgroundHelpers();
  assert.match(source, /targetLanguage !== "zh"/);
  assert.throws(
    () => validateTranscriptBatchRequest({ segments: [] }),
    /1 to 4 segments/,
  );
  assert.throws(
    () =>
      validateTranscriptBatchRequest({
        segments: [
          { id: "duplicate", text: "first" },
          { id: "duplicate", text: "second" },
        ],
      }),
    /unique and stable/,
  );
});

test("background accepts Overview and Notes translation batches", async () => {
  const requests = [];
  const helpers = loadBackgroundHelpers({
    fetchImpl: async (url, options) => {
      if (url.startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/translation.md") };
      }
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                segments: [{ id: "item-1", text: "\u4e2d\u6587\u7ed3\u679c\u3002" }],
              }),
            },
          }],
        }),
      };
    },
  });

  const overview = await helpers.handleTranslateContent(
    { segments: [{ id: "item-1", text: "Overview source." }] },
    "overviewBatch",
    "zh",
    "Video",
  );
  const notes = await helpers.handleTranslateContent(
    { segments: [{ id: "item-1", text: "Note source." }] },
    "notesBatch",
    "zh",
    "Video",
  );

  assert.equal(overview.success, true);
  assert.equal(notes.success, true);
  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[0].content, /Overview content items/);
  assert.match(requests[1].messages[0].content, /saved Note content items/);
});

test("all AI product requests use DeepSeek non-thinking and JSON behavior", async () => {
  const deepSeekRequests = [];
  const successfulFetch = (requests) => async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "translated" } }],
      }),
    };
  };

  const deepSeek = loadBackgroundHelpers({
    fetchImpl: successfulFetch(deepSeekRequests),
  });
  const deepSeekResult = await deepSeek.requestAiCompletion({
    maxTokens: 128,
    responseFormat: { type: "json_object" },
    messages: [{ role: "user", content: "Hello." }],
  });
  assert.equal(deepSeekResult.text, "translated");
  assert.deepEqual(deepSeekRequests[0].thinking, { type: "disabled" });
  assert.deepEqual(deepSeekRequests[0].response_format, {
    type: "json_object",
  });

  const backgroundSource = read("background.js");
  assert.equal(
    (backgroundSource.match(/await requestAiCompletion\(\{/g) || []).length,
    4,
  );
  assert.doesNotMatch(backgroundSource, /disableThinking/);
  for (const callPath of [
    "handleAnalyzeTranscript",
    "cleanupNoteText",
    "handleExplainSelection",
    "callAiTranslation",
  ]) {
    assert.match(
      backgroundSource,
      new RegExp(`async function ${callPath}\\([\\s\\S]*?requestAiCompletion\\(\\{`),
    );
  }
});

test("blank-line chunks reset provider idle timeout and valid JSON succeeds", async () => {
  const timers = createFakeTimers();
  const helpers = loadBackgroundHelpers({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async () =>
      streamingResponse([
        encode("\n"),
        encode("\n"),
        encode('{"choices":[{"message":{"content":"translated"}}]}'),
      ]),
  });

  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, true);
  assert.equal(result.text, "translated");
  assert.equal(timers.createdCount(50_000), 5);
  assert.equal(timers.activeCount(50_000), 0);
  assert.equal(timers.activeCount(120_000), 0);
});

test("provider idle silence aborts with a distinct Retry-able error", async () => {
  const timers = createFakeTimers();
  const helpers = loadBackgroundHelpers({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () =>
            new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              });
            }),
        }),
      },
    }),
  });

  const request = helpers.callAiTranslation("Translate.", "Hello.");
  await nextTurn();
  timers.fireActive(50_000);
  const result = await request;
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_IDLE_TIMEOUT");
  assert.match(result.error, /inactive for 50 seconds.*Retry/i);
  assert.equal(timers.activeCount(120_000), 0);
});

test("blank-line keepalives cannot evade the provider hard cap", async () => {
  const timers = createFakeTimers();
  let releaseRead;
  let signal;
  const helpers = loadBackgroundHelpers({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () =>
              new Promise((resolve, reject) => {
                releaseRead = () => resolve({ done: false, value: encode("\n") });
                signal.addEventListener("abort", () => {
                  const error = new Error("aborted");
                  error.name = "AbortError";
                  reject(error);
                }, { once: true });
              }),
          }),
        },
      };
    },
  });

  const request = helpers.callAiTranslation("Translate.", "Hello.");
  await nextTurn();
  releaseRead();
  await nextTurn();
  releaseRead();
  await nextTurn();
  assert.equal(timers.activeCount(50_000), 1);
  timers.fireActive(120_000);
  const result = await request;
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_HARD_TIMEOUT");
  assert.match(result.error, /120-second limit.*Retry/i);
  assert.equal(timers.activeCount(50_000), 0);
});

test("provider response reader accepts leading whitespace before JSON", async () => {
  const helpers = loadBackgroundHelpers({
    fetchImpl: async () =>
      streamingResponse([
        encode('  \n\t{"choices":[{"message":{"content":"ok"}}]}'),
      ]),
  });
  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, true);
  assert.equal(result.text, "ok");
});

test("provider response reader rejects bodies over 2 MiB", async () => {
  const helpers = loadBackgroundHelpers({
    fetchImpl: async () =>
      streamingResponse([new Uint8Array(2 * 1024 * 1024 + 1)]),
  });
  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_RESPONSE_TOO_LARGE");
  assert.match(result.error, /2 MiB limit/);
});

test("DeepSeek retries one empty transcript JSON response without response_format", async () => {
  const requests = [];
  const helpers = loadBackgroundHelpers({
    fetchImpl: async (url, options) => {
      if (url.startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/translation.md") };
      }
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: requests.length === 1
                ? ""
                : '{"segments":[{"id":"segment-0-0","text":"\u4e2d\u6587\u8bd1\u6587\u3002"}]}',
            },
          }],
        }),
      };
    },
  });
  const result = await helpers.handleTranslateContent(
    { segments: [{ id: "segment-0-0", text: "English source sentence." }] },
    "transcriptBatch",
    "zh",
    "Video",
  );
  assert.equal(result.success, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
  assert.equal(Object.hasOwn(requests[1], "response_format"), false);
  assert.equal(requests[0].max_tokens, 1536);
});

test("translation message watchdog rejects, clears its timer, and ignores late replies", async () => {
  let timeoutCallback;
  let timeoutDelay;
  let resolveMessage;
  let clearCount = 0;
  const helpers = loadSidepanelHelpers({
    sendMessage: () =>
      new Promise((resolve) => {
        resolveMessage = resolve;
      }),
    setTimeoutImpl(callback, delay) {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return 73;
    },
    clearTimeoutImpl(id) {
      assert.equal(id, 73);
      clearCount += 1;
    },
  });

  const request = helpers.sendTranslationMessage({
    action: "translateContent",
  });
  assert.equal(timeoutDelay, 130_000);
  timeoutCallback();
  await assert.rejects(request, /timed out after 130 seconds.*Retry/i);
  assert.equal(clearCount, 1);

  resolveMessage({ success: true });
  await Promise.resolve();
  assert.equal(clearCount, 1);

  let successTimeoutCallback;
  let successClearCount = 0;
  const successfulHelpers = loadSidepanelHelpers({
    sendMessage: () => Promise.resolve({ success: true }),
    setTimeoutImpl(callback) {
      successTimeoutCallback = callback;
      return 91;
    },
    clearTimeoutImpl(id) {
      assert.equal(id, 91);
      successClearCount += 1;
    },
  });
  assert.deepEqual(
    await successfulHelpers.sendTranslationMessage({
      action: "translateContent",
    }),
    { success: true },
  );
  assert.equal(successClearCount, 1);
  successTimeoutCallback();
  assert.equal(successClearCount, 1);
});

test("Chinese prompt preserves natural bilingual-learning style rules", () => {
  const prompt = read("prompts/translation.md");
  assert.match(prompt, /Translate the complete thought/);
  assert.match(prompt, /Use 你, never 您/);
  assert.match(prompt, /spaces between Chinese and adjacent English words or digits/);
  assert.match(prompt, /source-language `text`/);
});
