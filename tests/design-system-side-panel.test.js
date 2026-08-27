const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const html = read("sidepanel.html");
const css = read("sidepanel.css");
const js = read("sidepanel.js");
const fixture = JSON.parse(read("tests/fixtures/side-panel-reading-shell.fixture.json"));
const feedbackFixture = JSON.parse(read("tests/fixtures/side-panel-feedback.fixture.json"));
const notesExplainPlaybackFixture = JSON.parse(
  read("tests/fixtures/side-panel-notes-explain-playback.fixture.json"),
);

test("DS-02 defines a stable reading-shell fixture for 320, 390, and 480px", () => {
  assert.deepEqual(fixture.viewports, [320, 390, 480]);
  assert.deepEqual(fixture.controlStates, [
    "welcome",
    "default",
    "hover",
    "focus",
    "selected",
    "disabled",
  ]);
  assert.ok(fixture.video.title.length > 100);
  assert.ok(fixture.video.channel.length > 50);
  assert.match(fixture.transcript.timestamp, /^\d+:\d{2}$/);
  assert.match(fixture.chapter.timestamp, /^\d+:\d{2}$/);
  assert.match(fixture.quote.timestamp, /^\d+:\d{2}$/);
  assert.match(fixture.note.timestamp, /^\d+:\d{2}$/);
  assert.deepEqual(fixture.note.actions, ["Text", "Timestamp", "Play"]);
});

test("DS-02 reading shell retains labels and supplies the three-width geometry path", () => {
  assert.match(html, /role="tablist"[\s\S]*data-i18n-aria-label="sidepanel\.tabsLabel"/);
  for (const [tab, panel] of [
    ["Transcript", "panelTranscript"],
    ["Overview", "panelOverview"],
    ["Notes", "panelNotes"],
  ]) {
    assert.match(
      html,
      new RegExp(`role="tab"[\\s\\S]*aria-controls="${panel}"[\\s\\S]*data-i18n="sidepanel\\.tab${tab}"`),
    );
  }
  assert.match(css, /\.header\s*\{[^}]*padding:\s*var\(--comp-panel-inset\) var\(--comp-panel-inset\) 0;/);
  assert.match(css, /\.tabs\s*\{[^}]*overflow-x:\s*auto;/);
  assert.match(css, /\.tab\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*36px;/);
  assert.match(css, /@media \(max-width: 340px\)\s*\{[\s\S]*?--comp-panel-inset:\s*var\(--sys-layout-control-gap\);/);
  assert.match(css, /\.video-title\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/);
  assert.match(css, /\.video-channel\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
  assert.match(css, /\.transcript-time\s*\{[^}]*min-width:\s*46px;[^}]*font-variant-numeric:\s*tabular-nums;[^}]*white-space:\s*nowrap;/);
  assert.match(css, /\.chapter-item\s*\{[^}]*padding:\s*var\(--comp-card-padding\);[^}]*border-radius:\s*var\(--comp-card-radius\);/);
  assert.match(css, /\.quote-item\s*\{[^}]*padding:\s*var\(--comp-card-padding\);/);
  assert.match(css, /\.quote-item\s*\{[^}]*border-radius:\s*var\(--comp-card-radius\);/);
  assert.match(css, /\.note-item\s*\{[^}]*padding:\s*var\(--comp-card-padding\);/);
  assert.match(css, /\.note-item\s*\{[^}]*border-radius:\s*var\(--comp-card-radius\);/);
  assert.match(css, /\.note-actions\s*\{[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /\.quote-actions\s*\{[^}]*flex-wrap:\s*wrap;/);
});

test("DS-03 exposes static control semantics, keyboard focus, and disabled affordances", () => {
  assert.match(html, /role="tabpanel"[\s\S]*aria-labelledby="tabTranscript"/);
  assert.match(html, /role="tabpanel"[\s\S]*aria-labelledby="tabOverview"/);
  assert.match(html, /role="tabpanel"[\s\S]*aria-labelledby="tabNotes"/);
  assert.match(html, /id="loadingState"[\s\S]*role="status"[\s\S]*aria-live="polite"/);
  assert.match(html, /id="errorState"\s+role="alert"/);
  assert.match(js, /function handleTabKeydown\(event\)/);
  assert.match(js, /event\.key === "ArrowRight"/);
  assert.match(js, /event\.key === "ArrowLeft"/);
  assert.match(js, /tab\.setAttribute\("aria-selected", String\(active\)\)/);
  assert.match(js, /tab\.tabIndex = active \? 0 : -1;/);
  assert.match(js, /panel\.setAttribute\("aria-hidden", String\(!active\)\)/);
  assert.match(js, /<button class="transcript-time" type="button" aria-label="\$\{escapeHtml\(t\("transcript\.playFrom"/);
  assert.match(js, /li\.setAttribute\("role", "button"\)/);
  assert.match(js, /<button class="quote-timestamp" type="button" aria-label="\$\{escapeHtml\(t\("transcript\.playFrom"/);
  assert.match(js, /<button class="note-timestamp" type="button" aria-label="\$\{escapeHtml\(t\("notes\.openAt"/);
  assert.match(js, /class="note-delete" type="button"[\s\S]*aria-label="\$\{escapeHtml\(t\("notes\.delete"/);
  assert.match(css, /\.note-delete\s*\{[^}]*margin-left:\s*auto;[^}]*width:\s*var\(--comp-icon-button-size\);[^}]*height:\s*var\(--comp-icon-button-size\);/);
  assert.match(js, /note-copy-text[\s\S]*lucide-copy[\s\S]*note-action-label">\$\{escapeHtml\(t\("notes\.copyText"/);
  assert.match(js, /note-copy-link[\s\S]*lucide-link[\s\S]*note-action-label">\$\{escapeHtml\(t\("notes\.copyTimestamp"/);
  assert.match(js, /note-play[\s\S]*lucide-play[\s\S]*note-action-label">\$\{escapeHtml\(t\("notes\.play"/);
  assert.match(css, /button:focus-visible,[\s\S]*outline:\s*var\(--sys-state-focus-ring-width\) solid[\s\S]*outline-offset:\s*var\(--sys-state-focus-ring-offset\);/);
  const quoteDisabled = css.match(/\.quote-save-note-btn:disabled\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(quoteDisabled, /background:\s*var\(--sys-state-disabled-surface\);/);
  assert.match(quoteDisabled, /cursor:\s*not-allowed;/);
  assert.doesNotMatch(quoteDisabled, /opacity\s*:/);
});

test("Notes empty states use the Lucide notebook-pen icon instead of an emoji", () => {
  assert.match(html, /notes-intro[\s\S]*lucide-notebook-pen/);
  assert.match(js, /function renderNotes[\s\S]*lucide-notebook-pen[\s\S]*notes\.noneSuffix/);
  assert.doesNotMatch(js, /click 📝 Note to save/);
  assert.match(css, /\.notes-intro-icon\s*\{[^}]*width:\s*var\(--sys-icon-size-small\);[^}]*stroke:\s*currentColor;/);
});

test("DS-02 and DS-03 consume no ref token outside the token declaration layer", () => {
  const selectors = css.split("/* ============================================================\n   RESET & BASE")[1];
  assert.ok(selectors, "expected the token declaration layer before reset styles");
  assert.doesNotMatch(selectors, /var\(--ref-/);
});

test("DS-04 keeps transcript feedback tied to cache, request, configuration, and retry facts", () => {
  assert.equal(feedbackFixture.transcript.missingKey.action, "Open Settings");
  assert.equal(feedbackFixture.transcript.requestFailed.action, "Try Again");
  assert.match(html, /id="loadingState"[\s\S]*class="status-message status-message--loading"/);
  assert.match(html, /id="errorState"[\s\S]*role="alert"[\s\S]*class="status-message status-message--error"/);
  assert.match(js, /const cached = await loadFromCache\(videoId\);[\s\S]*?if \(cached\)[\s\S]*?renderTranscript\(\);[\s\S]*?showState\("results"\);/);
  assert.match(js, /showState\("loading"\);[\s\S]*?action: "fetchTranscript"/);
  assert.match(js, /transcriptResult\.error === "NO_SUPADATA_KEY"[\s\S]*?showConfigError\(\{ hasSupadataKey: false, hasAiKey: true \}\);/);
  assert.match(js, /errorBtn"\)\.textContent = t\(\s*"sidepanel\.openSettingsAction"/);
  assert.match(js, /errorBtn"\)\.textContent = t\("sidepanel\.retry"\)/);
});

test("DS-05 makes Overview lazy, local, readable when empty, and retryable on its real outcome", () => {
  assert.equal(feedbackFixture.overview.failed.action, "Retry overview");
  assert.deepEqual(feedbackFixture.overview.empty, { chapters: 0, keyQuotes: 0 });
  assert.match(html, /id="panelOverview"[\s\S]*data-overview-state="idle"/);
  assert.match(html, /id="overviewStatus"[\s\S]*role="status"[\s\S]*aria-live="polite"/);
  assert.match(js, /tabName === "overview" && !currentAnalysis && !isAnalysisLoading\) \{\s*triggerAnalysis\(\);/);
  assert.match(js, /renderOverviewStatus\("loading"\);[\s\S]*?action: "analyzeTranscript"/);
  assert.match(js, /analysisGeneration \+= 1;/);
  assert.match(js, /const requestGeneration = analysisGeneration;/);
  assert.match(js, /if \(requestGeneration !== analysisGeneration\) return;/);
  assert.match(js, /if \(requestGeneration === analysisGeneration\) isAnalysisLoading = false;/);
  assert.match(js, /renderOverviewStatus\([\s\S]*localizeServiceError\(analysisResult\.error\)/);
  assert.match(js, /retry\.addEventListener\("click", triggerAnalysis\);/);
  assert.match(js, /t\("overview\.noChapters"\)/);
  assert.match(js, /t\("overview\.noQuotes"\)/);
  assert.match(css, /\.overview-status--error\s*\{[^}]*border-color:\s*var\(--sys-state-error-border\);[^}]*background:\s*var\(--sys-state-error-surface\);/);
});

test("DS-06 retains the three modes while making row-level translation state explicit and non-color-only", () => {
  assert.deepEqual(feedbackFixture.translation.modes, ["original", "zh", "bilingual"]);
  assert.equal(feedbackFixture.translation.failed.action, "Retry");
  assert.match(js, /const translationState = translated \? "complete" : error \? "error" : "pending";/);
  assert.match(js, /data-translation-state="\$\{translationState\}" role="status" aria-live="polite"/);
  assert.match(js, /div\.dataset\.translationState = cached \? "complete" : "pending";/);
  assert.match(js, /row\.dataset\.translationState = alignedItem\.text \? "complete" : "error";/);
  assert.match(js, /row\.dataset\.translationState = "pending";/);
  assert.match(js, /mode === "bilingual"[\s\S]*transcript-original[\s\S]*transcript-translation/);
  assert.match(js, /generation !== translationGeneration \|\|[\s\S]*videoId !== currentVideoId \|\|[\s\S]*mode !== currentTranscriptMode/);
  assert.match(css, /data-translation-state="pending"[\s\S]*content:\s*"…"/);
  assert.match(css, /data-translation-state="error"[\s\S]*content:\s*"!"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(js, /function getPlaybackScrollBehavior\(\)[\s\S]*prefers-reduced-motion: reduce[\s\S]*"auto"[\s\S]*"smooth"/);
});

test("DS-07 keeps quote and note feedback local to real clipboard and storage outcomes", () => {
  assert.equal(notesExplainPlaybackFixture.quote.copy.success, "Quote copied.");
  assert.equal(
    notesExplainPlaybackFixture.notes.delete.failure,
    "Could not delete this note. Retry.",
  );
  assert.match(js, /function setLocalActionFeedback\([\s\S]*button\.disabled = state === "pending"/);
  assert.match(js, /action: "saveNote"[\s\S]*videoId: requestVideoId[\s\S]*timestamp: quote\.timestampSeconds/);
  assert.match(js, /label: `✓ \$\{t\("overview\.saved"\)\}`[\s\S]*message: t\("overview\.quoteSaved"\)/);
  assert.match(js, /label: t\("overview\.retrySave"\)[\s\S]*ariaLabel: t\("overview\.retrySaveQuote"\)/);
  assert.match(js, /action: "getNotes"[\s\S]*requestGeneration !== notesRequestGeneration/);
  assert.match(js, /action: "deleteNote"[\s\S]*noteId: noteId/);
  assert.match(js, /if \(result\?\.success\) \{[\s\S]*loadNotes\(filteredVideoId\);/);
  assert.match(js, /label: t\("notes\.retryDelete"\)[\s\S]*ariaLabel: t\("notes\.retryDeletingAria"\)/);
  assert.match(js, /t\("notes\.copyTextFailed"\)/);
  assert.match(js, /manualCopyText: note\.timestampedUrl/);
  assert.doesNotMatch(
    js.slice(js.indexOf("function renderAnalysisResults"), js.indexOf("function renderResults")),
    /setTimeout\(/,
  );
  assert.doesNotMatch(
    js.slice(js.indexOf("function renderNotes"), js.indexOf("// ============================================================\n// AUTO-SCROLL")),
    /setTimeout\(/,
  );
  assert.match(css, /\.quote-copy-btn\[data-feedback-state="success"\][\s\S]*--sys-state-success/);
  assert.match(css, /\.note-feedback\[data-feedback-state="error"\][\s\S]*--sys-state-error/);
});

test("DS-07 makes Explain a retryable dialog without cancelling or accepting stale requests", () => {
  assert.deepEqual(notesExplainPlaybackFixture.explain.states, [
    "loading",
    "success",
    "error",
  ]);
  assert.match(js, /role="dialog" aria-modal="true" aria-labelledby="explainModalTitle"/);
  assert.match(js, /aria-label="\$\{escapeHtml\(t\("explain\.close"\)\)\}"/);
  assert.match(js, /function closeExplanationPresentation\(modal\)[\s\S]*explanationGeneration \+= 1[\s\S]*modal\.remove\(\)/);
  assert.match(js, /function explanationPresentationIsCurrent\([\s\S]*modal\?\.isConnected[\s\S]*requestGeneration === explanationGeneration[\s\S]*videoId === currentVideoId/);
  assert.match(js, /action: "explainSelection"[\s\S]*selectedText: request\.selectedText[\s\S]*transcriptContext: request\.transcriptContext[\s\S]*videoTitle: request\.videoTitle/);
  assert.match(js, /retryButton\.textContent = t\("explain\.retry"\)/);
  assert.match(js, /retry: \(\) => requestExplanation\(modal, request\)/);
  assert.match(css, /\.explain-loading-indicator\s*\{[^}]*--sys-state-info/);
  assert.match(css, /\.explain-error\s*\{[^}]*--sys-state-error/);
  assert.match(css, /\.explain-modal-close\s*\{[^}]*width:\s*var\(--comp-icon-button-size\);/);
});

test("DS-07 keeps playback position distinct from following state", () => {
  assert.match(html, /id="followPlaybackBtn"[\s\S]*data-i18n-aria-label="follow\.resume"[\s\S]*lucide-locate-fixed/);
  assert.match(html, /id="followPlaybackStatus"[\s\S]*role="status"[\s\S]*aria-live="polite"/);
  assert.match(js, /function setFollowPlaybackState\(state\)[\s\S]*state === "paused"[\s\S]*t\("follow\.paused"\)/);
  assert.match(js, /state === "paused" && isTranscriptTabActive\(\) \? "paused" : "inactive"/);
  assert.match(js, /function isTranscriptTabActive\(\)[\s\S]*data-tab="transcript"[\s\S]*classList\.contains\("active"\)/);
  assert.match(js, /function setPlaybackEntryState\(entry, isCurrent\)[\s\S]*entry\.setAttribute\("aria-current", "true"\)/);
  assert.match(js, /entries\.forEach\(\(e\) => \{[\s\S]*e\.classList\.remove\("active-playback"\)[\s\S]*setPlaybackEntryState\(e, false\)[\s\S]*\}\);[\s\S]*activeEntry\.classList\.add\("active-playback"\)[\s\S]*setPlaybackEntryState\(activeEntry, true\)/);
  assert.match(js, /autoScrollEnabled = false;[\s\S]*setFollowPlaybackState\("paused"\);/);
  assert.match(js, /autoScrollEnabled = true;[\s\S]*setFollowPlaybackState\("following"\);[\s\S]*scrollToActiveEntry\("auto"\)/);
  assert.match(js, /function scrollToActiveEntry\(behavior = getPlaybackScrollBehavior\(\)\)[\s\S]*scrollIntoView\(\{ behavior, block: "center" \}\)/);
  assert.match(css, /\.transcript-entry\.active-playback \.transcript-time::before\s*\{[^}]*content:\s*"▶"/);
  assert.match(css, /\.follow-playback-btn\s*\{[^}]*right:\s*var\(--comp-panel-inset\);[^}]*bottom:\s*var\(--comp-panel-inset\);[^}]*border-radius:\s*50%;/);
  assert.match(css, /\.follow-playback-btn \.lucide\s*\{[^}]*stroke:\s*currentColor;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(js, /function getPlaybackScrollBehavior\(\)[\s\S]*"auto"[\s\S]*"smooth"/);
  assert.match(js, /if \(autoScrollEnabled && autoScrollInterval\) \{[\s\S]*autoScrollEnabled = false;[\s\S]*setFollowPlaybackState\("paused"\);/);
});
