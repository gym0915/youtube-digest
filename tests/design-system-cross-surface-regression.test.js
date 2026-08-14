const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const sidePanel = {
  css: read("sidepanel.css"),
  html: read("sidepanel.html"),
  js: read("sidepanel.js"),
};
const settings = {
  css: read("options.css"),
  html: read("options.html"),
  js: read("options.js"),
};
const host = read("content.js");
const fixture = JSON.parse(
  read("tests/fixtures/cross-surface-consistency-regression.fixture.json"),
);

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.notEqual(start, -1, `missing ${name}`);
  assert.notEqual(end, -1, `missing ${nextName}`);
  return source.slice(start, end);
}

test("DS-12 keeps English, Simplified Chinese, bilingual text, and long content in their approved containers", () => {
  assert.equal(fixture.scenario, "DS-12-DS-15");
  assert.deepEqual(fixture.surfaces, ["side-panel", "settings", "youtube-host"]);
  assert.deepEqual(fixture.settingsLanguages, ["en", "zh-CN"]);
  assert.deepEqual(fixture.transcriptModes, ["original", "zh", "bilingual"]);
  assert.ok(fixture.longContent.videoTitle.length > 120);
  assert.match(fixture.longContent.crossVideoTitle, /跨视频笔记/);
  assert.match(fixture.longContent.prompt, /\[PROVIDER\].*\[MODEL\]/);

  assert.match(sidePanel.css, /\.video-title\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/);
  assert.match(sidePanel.css, /\.video-channel\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
  assert.match(sidePanel.css, /\.note-video-title\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/);
  assert.match(sidePanel.css, /\.transcript-original,\s*\.transcript-translation\s*\{[^}]*display:\s*block;/);
  assert.match(sidePanel.css, /\.transcript-original \+ \.transcript-translation\s*\{[^}]*border-top:/);
  assert.match(sidePanel.js, /mode === "bilingual"[\s\S]*transcript-original[\s\S]*transcript-translation/);
  assert.match(sidePanel.css, /\.transcript-time\s*\{[^}]*min-width:\s*46px;[^}]*font-variant-numeric:\s*tabular-nums;[^}]*white-space:\s*nowrap;/);

  assert.match(settings.html, /data-language="en"[\s\S]*data-language="zh-CN"/);
  assert.match(settings.html, /<textarea id="customizationPrompt" rows="12"/);
  assert.match(settings.css, /textarea\s*\{[^}]*min-height:\s*190px;[^}]*resize:\s*vertical;[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/);
  assert.match(settings.css, /\.settings-field \.help,[\s\S]*\.status-message\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.doesNotMatch(`${sidePanel.css}\n${settings.css}`, /word-break:\s*break-all/i);

  assert.match(host, /<span class="ytd-digest-label">Digest<\/span>/);
  assert.match(host, /white-space:\s*nowrap;/);
  assert.match(host, /width: min\(350px, calc\(100vw - 24px\)\)/);
});

test("DS-13 keeps keyboard, focus, semantic state, and live feedback available on every surface", () => {
  assert.match(sidePanel.html, /role="tablist"[\s\S]*aria-label="Digest views"/);
  assert.match(sidePanel.html, /role="tabpanel"[\s\S]*aria-labelledby="tabTranscript"/);
  assert.match(sidePanel.js, /function handleTabKeydown\(event\)[\s\S]*ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/);
  assert.match(sidePanel.js, /switchTab\(nextTab\.dataset\.tab\);[\s\S]*nextTab\.focus\(\);/);
  assert.match(sidePanel.js, /tab\.setAttribute\("aria-selected", String\(active\)\);[\s\S]*tab\.tabIndex = active \? 0 : -1;/);
  assert.match(sidePanel.html, /id="followPlaybackStatus"[\s\S]*role="status"[\s\S]*aria-live="polite"/);

  assert.match(settings.html, /class="segmented-control language-switch"[\s\S]*role="group"[\s\S]*aria-label="Interface language"[\s\S]*data-segmented-control/);
  assert.match(settings.html, /id="saveStatus"[\s\S]*role="status"[\s\S]*aria-live="polite"/);
  assert.match(settings.js, /button\.disabled = isPending;[\s\S]*button\.setAttribute\("aria-busy", String\(isPending\)\);/);

  assert.match(host, /setAttribute\("aria-label", "Open YouTube Digest"\)/);
  assert.match(host, /setAttribute\("aria-live", "polite"\);[\s\S]*setAttribute\("aria-hidden", "true"\);/);
  assert.match(host, /copy-status[\s\S]*role="status" aria-live="polite"/i);
  assert.match(host, /noteButton\.tabIndex = isVisible && !isSaving \? 0 : -1;/);

  for (const source of [sidePanel.css, settings.css, host]) {
    assert.match(source, /--sys-state-focus-ring-width:\s*2px;[\s\S]*--sys-state-focus-ring-offset:\s*2px;/);
    assert.match(source, /focus-visible/);
  }
});

test("DS-14 keeps state channels distinct, non-colour feedback explicit, and motion optional", () => {
  assert.deepEqual(fixture.stateChannels, [
    "brand-primary-action",
    "success",
    "error",
    "warning",
    "info",
    "disabled",
    "focus",
    "playback",
    "loading",
  ]);

  for (const source of [sidePanel.css, settings.css, host]) {
    assert.match(source, /--sys-action-primary-bg:\s*var\(--ref-color-brand-red-strong\);/);
    assert.match(source, /--sys-state-success-foreground:\s*var\(--ref-color-state-success-foreground\);/);
    assert.match(source, /--sys-state-error-foreground:\s*var\(--ref-color-state-error-foreground\);/);
    assert.match(source, /--sys-state-focus-ring-color:\s*var\(--ref-color-focus-ring\);/);
    assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);
  }

  assert.match(sidePanel.css, /\.transcript-entry\.active-playback\s*\{[^}]*background:\s*var\(--sys-interaction-selected\);[^}]*border-left-color:\s*transparent;[^}]*border-radius:\s*var\(--sys-shape-large-surface\);/);
  assert.match(sidePanel.css, /\.transcript-entry\.active-playback \.transcript-time::before\s*\{[^}]*content:\s*"▶"/);
  assert.match(sidePanel.css, /data-translation-state="error"[\s\S]*content:\s*"!"/);
  for (const [selector, pattern] of [
    [".transcript-source-badge", /\.transcript-source-badge\s*\{([^}]*)\}/],
    [".translation-pending", /\.translation-pending\s*\{([^}]*)\}/],
    [".transcript-paragraph.translating", /\.transcript-paragraph\.translating\s*\{([^}]*)\}/],
    [".transcript-entry.translating .transcript-text", /\.transcript-entry\.translating \.transcript-text\s*\{([^}]*)\}/],
    [".loading-subtext", /\.loading-subtext\s*\{([^}]*)\}/],
    [".video-channel", /\.video-channel\s*\{([^}]*)\}/],
    [".notes-intro", /\.notes-intro\s*\{([^}]*)\}/],
    [".note-video-title", /\.note-video-title\s*\{([^}]*)\}/],
  ]) {
    const rule = sidePanel.css.match(pattern)?.[1];
    assert.ok(rule, `missing ${selector}`);
    assert.match(rule, /color:\s*var\(--sys-text-secondary\);/);
    assert.doesNotMatch(rule, /--sys-text-muted|--text-muted/);
  }
  assert.match(settings.css, /\.status-message\[data-state="success"\][\s\S]*content:\s*"✓"/);
  assert.match(settings.css, /\.status-message\[data-state="error"\][\s\S]*content:\s*"!"/);
  assert.match(host, /<span aria-hidden="true">✓<\/span><span>Saved<\/span>/);
  assert.match(host, /<span aria-hidden="true">!<\/span><span>Could not save note\. Try again\.<\/span>/);

  const contrast = (foreground, background) => {
    const luminance = (hex) => {
      const channels = hex.match(/[a-f\d]{2}/gi).map((channel) =>
        Number.parseInt(channel, 16) / 255,
      );
      const linear = channels.map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
      (first, second) => second - first,
    );
    return (lighter + 0.05) / (darker + 0.05);
  };
  assert.ok(contrast("#606060", "#ffffff") >= 4.5);
});

test("DS-15 preserves the established asynchronous and host responsibilities instead of adding a cross-surface pathway", () => {
  assert.deepEqual(fixture.functionalContracts, [
    "overview-lazy-load",
    "row-level-translation-retry",
    "settings-local-storage-and-reset-confirmation",
    "digest-note-toast",
    "n-shortcut-and-spa-cleanup",
  ]);

  assert.match(sidePanel.js, /tabName === "overview" && !currentAnalysis && !isAnalysisLoading\) \{\s*triggerAnalysis\(\);/);
  assert.match(sidePanel.js, /generation !== translationGeneration \|\|[\s\S]*videoId !== currentVideoId \|\|[\s\S]*mode !== currentTranscriptMode/);
  assert.match(settings.js, /const confirmed = root\.confirm\(\s*translate\(currentLanguage, "resetConfirm"\),\s*\);\s*if \(!confirmed\) return;/);
  assert.match(settings.js, /await storage\.clear\(\);/);
  assert.match(host, /action: "openSidePanel"/);
  assert.match(host, /action: "saveNote"[\s\S]*timestamp: currentTime/);
  assert.match(host, /function handleNoteKeyboardShortcut\(e\)[\s\S]*active\.tagName === "INPUT"[\s\S]*active\.tagName === "TEXTAREA"[\s\S]*active\.isContentEditable/);
  assert.match(host, /hostPageLifecycleEpoch \+= 1;/);

  const transcriptCopy = functionSource(
    sidePanel.js,
    "copyToClipboardWithFeedback",
    "downloadTextFile",
  );
  assert.match(transcriptCopy, /await copyToClipboard\(text\)/);
  assert.match(transcriptCopy, /btn\.dataset\.feedbackState = "success"/);
  assert.match(transcriptCopy, /btn\.dataset\.feedbackState = "error"/);
  assert.match(transcriptCopy, /btn\.setAttribute\("aria-label", "Transcript copied"\)/);
  assert.match(transcriptCopy, /btn\.setAttribute\("aria-label", "Retry copying transcript"\)/);
  assert.doesNotMatch(transcriptCopy, /setTimeout\s*\(/);
  assert.doesNotMatch(functionSource(sidePanel.js, "triggerAnalysis", "seekTo"), /setTimeout\s*\(/);
  assert.match(host, /function scheduleNoteButtonStateReset[\s\S]*}, 2000\);/);
  assert.match(host, /ytdNoteToastDismissTimer = setTimeout\([\s\S]*}, 5000\);/);

  for (const source of [sidePanel.css, settings.css, host]) {
    assert.match(source, /--sys-type-body:\s*400 14px\/1\.6 var\(--sys-font-reading\);/);
  }
  assert.match(host, /--ref-font-reading:\s*var\(--ref-font-ui\);/);
  assert.match(host, /--sys-font-reading:\s*var\(--ref-font-reading\);/);
  assert.doesNotMatch(host, /--sys-layout-card-padding:/);
});
