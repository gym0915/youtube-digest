const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const i18n = require("../i18n.js");

function createStorage() {
  const values = {};
  return {
    async get(key) {
      return Object.hasOwn(values, key) ? { [key]: values[key] } : {};
    },
    async set(items) {
      Object.assign(values, items);
    },
  };
}

test("shared locale contract supplies confirmed Chinese copy for each product surface", () => {
  const chinese = "zh-CN";

  assert.equal(i18n.translate(chinese, "sidepanel.tabTranscript"), "字幕");
  assert.equal(i18n.translate(chinese, "sidepanel.tabOverview"), "概览");
  assert.equal(i18n.translate(chinese, "sidepanel.tabNotes"), "笔记");
  assert.equal(i18n.translate(chinese, "transcript.modeOriginal"), "原文");
  assert.equal(i18n.translate(chinese, "transcript.waiting"), "正在等待翻译…");
  assert.equal(i18n.translate(chinese, "notes.savedTitle"), "已保存的笔记");
  assert.equal(i18n.translate(chinese, "notes.copyText"), "文本");
  assert.equal(i18n.translate(chinese, "host.noteSaved"), "笔记已保存");
  assert.equal(i18n.translate(chinese, "host.copyLink"), "复制链接");
  assert.equal(i18n.translate(chinese, "notes.play"), "播放");

  assert.deepEqual(
    Object.keys(i18n.COPY.en).sort(),
    Object.keys(i18n.COPY["zh-CN"]).sort(),
  );
});

test("persisted locale is shared through the existing language preference", async () => {
  const storage = createStorage();

  await i18n.persistPreferredLanguage(storage, "zh-CN");

  assert.equal(
    await i18n.readPreferredLanguage(storage),
    "zh-CN",
  );
  assert.equal(i18n.normalizeLanguage("unsupported"), "en");
});

test("static UI targets render from translation keys without embedded copy", () => {
  const transcriptTab = {
    dataset: { i18n: "sidepanel.tabTranscript" },
    textContent: "",
  };
  const settingsButton = {
    dataset: { i18nAriaLabel: "sidepanel.openSettings" },
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const root = {
    documentElement: { lang: "" },
    querySelectorAll(selector) {
      if (selector === "[data-i18n]") return [transcriptTab];
      if (selector === "[data-i18n-html]") return [];
      if (selector === "[data-i18n-aria-label]") return [settingsButton];
      if (selector === "[data-i18n-title]") return [];
      if (selector === "[data-i18n-placeholder]") return [];
      return [];
    },
  };

  i18n.localizeDocument(root, "zh-CN");

  assert.equal(root.documentElement.lang, "zh-CN");
  assert.equal(transcriptTab.textContent, "字幕");
  assert.equal(settingsButton.attributes["aria-label"], "打开 YouTube Digest 设置");
});

test("side panel markup and YouTube control bridge use the shared locale contract", () => {
  const root = path.resolve(__dirname, "..");
  const sidepanelHtml = fs.readFileSync(
    path.join(root, "sidepanel.html"),
    "utf8",
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const sidepanel = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");

  const keys = [
    ...sidepanelHtml.matchAll(
      /data-i18n(?:-html|-aria-label|-title|-placeholder)?="([^"]+)"/g,
    ),
  ].map((match) => match[1]);
  for (const key of keys) {
    assert.ok(i18n.COPY.en[key], `Missing English copy for ${key}`);
    assert.ok(i18n.COPY["zh-CN"][key], `Missing Chinese copy for ${key}`);
  }

  assert.deepEqual(manifest.content_scripts[0].js.slice(0, 2), [
    "i18n.js",
    "content.js",
  ]);
  assert.match(background, /message\.action === "getUiLanguage"/);
  assert.match(background, /action: "uiLanguageChanged"/);
  assert.match(content, /message\.action === "uiLanguageChanged"/);
  assert.match(sidepanel, /chrome\.storage\.onChanged\.addListener/);
});
