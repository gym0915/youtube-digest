/**
 * SIDE PANEL LOGIC
 *
 * Handles the UI for YouTube Digest: video detection, transcript analysis,
 * rendering results, and export features.
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};
const I18N = YTD_I18N;
let currentUiLanguage = I18N.DEFAULT_LANGUAGE;
const t = (key, params) => I18N.translate(currentUiLanguage, key, params);

// ============================================================
// STATE
// ============================================================

let currentVideoId = null;
let currentVideoUrl = null;
let currentAnalysis = null;
let currentTranscript = null;
let currentTranscriptText = null; // Plain text (for display/export)
let currentTranscriptTimestamped = null; // With timestamps for AI analysis
let currentTranscriptLanguage = null;
let currentVideoTitle = "";
let currentChannelName = "";
let currentVideoDescription = "";
let currentVideoDuration = 0;
let isAnalysisLoading = false; // Track if analysis is in progress
let analysisGeneration = 0; // Invalidates Overview responses from an older video.
let notesRequestGeneration = 0; // Ignores notes responses for an older filter/video.
let explanationGeneration = 0; // Lets closing or changing video end only the visual presentation.
let explainSelectionCleanup = null;
let youtubeTabId = null; // Store the YouTube tab ID for reliable messaging
let errorAction = null;
let renderedNotes = null;
let renderedNotesFilter = null;
let visibleError = null;

// --- Translation state ---
// The public transcript control intentionally supports only the original
// subtitles, Chinese, and an aligned source + Chinese view.
let currentTranscriptMode = "original";
let translationGeneration = 0; // Invalidates responses from older UI modes/videos.
let translationWorkCount = 0;
let transcriptScrollObserver = null;
// Stable keys include the video, target language, and semantic segment ID.
let transcriptParagraphCache = new Map();
const transcriptTranslationInFlight = new Map();
let transcriptCacheWriteChain = Promise.resolve();
const TRANSLATION_MESSAGE_TIMEOUT_MS = 130_000;

/**
 * Prevent a stopped service worker or dead message channel from leaving the
 * transcript queue stuck forever. The underlying Chrome message cannot be
 * cancelled, so settled guards deliberately ignore any late response.
 */
function sendTranslationMessage(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(value);
    };

    timeoutId = setTimeout(() => {
      finish(
        reject,
        new Error(
          "Translation request timed out after 130 seconds. Please Retry.",
        ),
      );
    }, TRANSLATION_MESSAGE_TIMEOUT_MS);

    let messagePromise;
    try {
      messagePromise = chrome.runtime.sendMessage(message);
    } catch (error) {
      finish(reject, error);
      return;
    }

    Promise.resolve(messagePromise).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

// --- Auto-scroll state (follow video playback in transcript) ---
let autoScrollEnabled = true; // True = scroll transcript to follow video playback
let autoScrollInterval = null; // setInterval ID for polling video time
let lastUserScrollIntentTime = 0;
const USER_SCROLL_INTENT_WINDOW_MS = 1_000;

// ============================================================
// TRANSCRIPT GROUPING
// ============================================================

const TRANSCRIPT_SEGMENT_LIMITS = Object.freeze({
  minChars: 60,
  idealChars: 180,
  maxChars: 320,
  maxSeconds: 20,
});

function normalizeCaptionText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
    .replace(/([，。；：！？])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .trim();
}

/**
 * Splits a single oversized thought at the strongest nearby punctuation.
 * Word boundaries are the final safety valve for captions with no punctuation.
 */
function splitOversizedThought(text, maxChars) {
  const parts = [];
  let rest = normalizeCaptionText(text);

  while (rest.length > maxChars) {
    const windowText = rest.slice(0, maxChars + 1);
    const lowerBound = Math.floor(maxChars * 0.55);
    let cut = -1;

    for (const pattern of [/[;:；：]\s*/g, /[,，]\s*/g, /\s/g]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(windowText))) {
        if (match.index >= lowerBound) cut = match.index + match[0].length;
      }
      if (cut > 0) break;
    }

    if (cut <= 0) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/**
 * Reconstructs complete sentences across raw caption boundaries. Each segment
 * keeps the timestamp of the first caption that contributed text. Character
 * and time limits prevent a malformed Supadata entry from becoming one giant
 * row while punctuation remains the preferred boundary.
 */
function groupTranscriptEntries(entries, limits = TRANSCRIPT_SEGMENT_LIMITS) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const pieces = [];
  entries.forEach((entry, entryIndex) => {
    const text = normalizeCaptionText(entry?.text);
    if (!text) return;
    const start = Number.isFinite(Number(entry.start)) ? Number(entry.start) : 0;
    const duration = Math.max(0, Number(entry.duration) || 0);
    const sentenceParts =
      text.match(/[^.!?;:,。！？；：，]+(?:[.!?;:,。！？；：，]+["')\]”’）】」』]*|$)/g) ||
      [text];
    let consumedChars = 0;

    sentenceParts.forEach((sentencePart) => {
      const cleanPart = normalizeCaptionText(sentencePart);
      if (!cleanPart) return;
      const oversizedParts = splitOversizedThought(cleanPart, limits.maxChars);
      oversizedParts.forEach((part, partIndex) => {
        const ratio = text.length ? Math.min(1, consumedChars / text.length) : 0;
        pieces.push({
          text: part,
          start: start + duration * ratio,
          semanticEnd:
            /[.!?。！？]["')\]”’）】」』]*$/.test(part) ||
            oversizedParts.length > 1,
          clauseEnd: /[;:,；：，]["')\]”’）】」』]*$/.test(part),
          sourceOrder: `${entryIndex}:${partIndex}`,
        });
        consumedChars += part.length + 1;
      });
    });
  });

  const grouped = [];
  let current = null;

  const flush = () => {
    if (!current || !current.text.trim()) return;
    const index = grouped.length;
    const text = normalizeCaptionText(current.text);
    grouped.push({
      id: `segment-${index}-${Math.round(current.start * 1000)}`,
      start: current.start,
      text,
      texts: [text],
    });
    current = null;
  };

  pieces.forEach((piece) => {
    if (!current) current = { start: piece.start, text: "" };
    current.text = normalizeCaptionText(`${current.text} ${piece.text}`);
    const elapsed = Math.max(0, piece.start - current.start);
    const comfortablySized = current.text.length >= limits.minChars;
    const reachedIdeal = current.text.length >= limits.idealChars;
    const atNaturalBoundary =
      piece.semanticEnd ||
      (piece.clauseEnd &&
        (reachedIdeal ||
          current.text.length >= limits.maxChars ||
          elapsed >= limits.maxSeconds));
    const reachedGuardrail =
      atNaturalBoundary &&
      (current.text.length >= limits.maxChars || elapsed >= limits.maxSeconds);
    const reachedHardGuardrail =
      current.text.length >= Math.round(limits.maxChars * 1.2) ||
      elapsed >= limits.maxSeconds + 5;

    if (
      (atNaturalBoundary && (comfortablySized || elapsed >= 8)) ||
      (atNaturalBoundary && reachedIdeal) ||
      reachedGuardrail ||
      reachedHardGuardrail
    ) {
      flush();
    }
  });
  flush();

  return grouped;
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  await initializeUiLanguage();
  window.YTD_SEGMENTED_CONTROL?.initialize(document);
  setupEventListeners();
  await evictOldCacheEntries(20);

  const configStatus = await chrome.runtime.sendMessage({
    action: "checkConfig",
  });

  if (!configStatus.hasSupadataKey || !configStatus.hasAiKey) {
    showConfigError(configStatus);
    return;
  }

  await checkCurrentTab();
});

async function initializeUiLanguage() {
  try {
    currentUiLanguage = await I18N.readPreferredLanguage(chrome.storage.local);
  } catch (error) {
    currentUiLanguage = I18N.DEFAULT_LANGUAGE;
  }
  applyUiLanguage();
}

function applyUiLanguage() {
  I18N.localizeDocument(document, currentUiLanguage);
  document.title = t("sidepanel.pageTitle");
  refreshTranscriptUiCopy();
  if (currentAnalysis) renderAnalysisResults(currentAnalysis);
  if (renderedNotes) renderNotes(renderedNotes, renderedNotesFilter);
  if (visibleError?.kind === "config") {
    renderConfigError(visibleError.configStatus);
  } else if (visibleError?.kind === "generic") {
    renderError(visibleError.title, visibleError.message);
  }
  const followState = document.getElementById("followPlaybackBtn")?.dataset
    .followState;
  if (followState) setFollowPlaybackState(followState);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  const change = changes[I18N.LANGUAGE_STORAGE_KEY];
  if (areaName !== "local" || !change) return;
  currentUiLanguage = I18N.normalizeLanguage(change.newValue);
  applyUiLanguage();
});

// Listen for messages from the Digest button on YouTube page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startDigestFromButton") {
    // Load the digest for the current video. Served from cache when we've
    // seen this video before (no API calls); fetched fresh otherwise.
    // (This used to force-clear the cache on every click, which silently
    // burned a transcript credit + analysis tokens per click.)
    checkCurrentTab();
    sendResponse({ success: true });
  }
  if (message.action === "transcriptProgress") {
    // Background is telling us the transcript fetch status changed
    updateLoading(message.title, message.subtitle);
    sendResponse({ success: true });
  }
  if (message.action === "noteSaved") {
    // Refresh notes list when a new note is saved
    const filterAll = document
      .getElementById("notesFilterAll")
      ?.classList.contains("active");
    loadNotes(filterAll ? null : currentVideoId);
    sendResponse({ success: true });
  }
  return false;
});

// ============================================================
// FOLLOW THE ACTIVE TAB
// ============================================================
// The panel watches which tab is in front of it and reacts:
//   - Front tab is NOT YouTube  -> the panel closes itself (window.close()).
//     We do this OURSELVES rather than relying only on the background
//     script's per-tab enable/disable, because Chrome doesn't reliably
//     apply per-tab panel state to tabs spawned in unusual ways (e.g. a
//     link opened from another app) — which let the panel linger on
//     non-YouTube pages.
//   - Front tab IS YouTube but on a different video -> refresh the digest.
//     YouTube is a single-page app (clicking a video swaps content without
//     a reload), so we track URL changes; startDigest() caches per video,
//     making re-checks instant and free for already-digested videos.
//
// Everything is scoped to the window this panel lives in: tab switches in
// OTHER browser windows must not close this panel or hijack its content.

let navigationRefreshTimer = null;
let panelWindowId = null;
chrome.windows.getCurrent().then((w) => {
  panelWindowId = w.id;
});

function scheduleDigestRefresh() {
  // Small delay lets YouTube finish rendering the new video's title and
  // description before we read them. Also collapses rapid-fire URL events
  // into a single refresh.
  clearTimeout(navigationRefreshTimer);
  navigationRefreshTimer = setTimeout(() => {
    checkCurrentTab();
  }, 600);
}

function panelIsShowingResults() {
  const results = document.getElementById("resultsState");
  return results && results.style.display !== "none";
}

/**
 * Reacts to the URL now in front of the panel: close on non-YouTube,
 * refresh the digest when the video changed.
 */
function handleFrontTabUrl(url) {
  if (!(url || "").startsWith("https://www.youtube.com")) {
    // Panel is a YouTube-only tool — remove itself from non-YouTube tabs.
    window.close();
    return;
  }

  const newVideoId = extractVideoId(url);
  // Refresh when the video changed, or when we're not currently showing
  // results (e.g. user went home, then clicked back into the same video).
  if (newVideoId !== currentVideoId || !panelIsShowingResults()) {
    scheduleDigestRefresh();
  }
}

// Fires when a tab's URL changes — including YouTube's no-reload navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.active) return;
  if (panelWindowId !== null && tab.windowId !== panelWindowId) return;
  handleFrontTabUrl(changeInfo.url);
});

// Fires when a different tab comes to the front — switching tabs, or a new
// tab being opened (including ones opened by clicking links in other apps).
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (panelWindowId !== null && windowId !== panelWindowId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    // Brand-new tabs may not have committed their URL yet — fall back to
    // the pending one so we judge where the tab is actually going.
    handleFrontTabUrl(tab.url || tab.pendingUrl || "");
  } catch (e) {
    // Tab closed before we could read it — nothing to do.
  }
});

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    tab.addEventListener("keydown", handleTabKeydown);
  });

  // Error retry
  document.getElementById("errorBtn").addEventListener("click", () => {
    if (errorAction) {
      errorAction();
      return;
    }
    if (currentVideoId) {
      startDigest(currentVideoId, currentVideoUrl);
    }
  });

  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openOptions" });
  });

  // Transcript actions
  document
    .getElementById("copyTranscriptBtn")
    ?.addEventListener("click", copyTranscript);
  document
    .getElementById("exportTranscriptBtn")
    ?.addEventListener("click", exportTranscript);
  document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      handleTranscriptModeChange(button.dataset.transcriptMode);
    });
  });

  // Follow playback button — re-enables auto-scroll after user scrolled away
  document
    .getElementById("followPlaybackBtn")
    ?.addEventListener("click", () => {
      autoScrollEnabled = true;
      setFollowPlaybackState("following");
      // Jump straight back to the line currently being spoken. We scroll
      // directly (not via playbackTrackingTick) because the tick skips
      // entries that are already highlighted — and the current line almost
      // always IS highlighted, which made this button appear to do nothing.
      // Use an immediate jump for recovery. A long smooth scroll can outlive
      // the scroll-event grace period below and be mistaken for another
      // manual scroll, which would show this button again right after click.
      if (!scrollToActiveEntry("auto")) {
        playbackTrackingTick(); // No highlight yet — let a tick establish one
      }
    });

  // Notes filter buttons
  document.getElementById("notesFilterThis")?.addEventListener("click", () => {
    setNotesFilter(false);
    loadNotes(currentVideoId);
  });
  document.getElementById("notesFilterAll")?.addEventListener("click", () => {
    setNotesFilter(true);
    loadNotes(null); // Load all notes
  });
}

/**
 * ARIA tabs keep their existing click behavior while adding the standard
 * arrow/Home/End keyboard path. Activating a tab still delegates to
 * switchTab(), preserving its lazy Overview and playback contracts.
 */
function handleTabKeydown(event) {
  const tabs = [...document.querySelectorAll(".tab")];
  const currentIndex = tabs.indexOf(event.currentTarget);
  if (currentIndex === -1) return;

  let nextIndex = null;
  if (event.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % tabs.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = tabs.length - 1;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  const nextTab = tabs[nextIndex];
  switchTab(nextTab.dataset.tab);
  nextTab.focus();
}

function setNotesFilter(showAll) {
  const thisVideoButton = document.getElementById("notesFilterThis");
  const allNotesButton = document.getElementById("notesFilterAll");
  const control = thisVideoButton?.closest("[data-segmented-control]");
  const selected = showAll ? allNotesButton : thisVideoButton;
  if (control && window.YTD_SEGMENTED_CONTROL?.select(control, selected)) return;

  thisVideoButton?.setAttribute("aria-pressed", String(!showAll));
  allNotesButton?.setAttribute("aria-pressed", String(showAll));
}

// ============================================================
// VIDEO DETECTION
// ============================================================

async function checkCurrentTab() {
  try {
    // Try multiple strategies to find the YouTube tab
    let tab = null;

    // Strategy 1: Active tab in last focused window
    let tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tabs[0]?.url?.includes("youtube.com")) {
      tab = tabs[0];
    }

    // Strategy 2: Any active YouTube tab
    if (!tab) {
      tabs = await chrome.tabs.query({
        url: "https://www.youtube.com/*",
        active: true,
      });
      if (tabs[0]) tab = tabs[0];
    }

    // Strategy 3: Any YouTube tab (last resort)
    if (!tab) {
      tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
      if (tabs[0]) tab = tabs[0];
    }

    debugLog("[YouTube Digest Panel] Found tab:", tab?.id, tab?.url);

    if (!tab?.url) {
      showState("welcome");
      return;
    }

    // Store the tab ID for reliable messaging later
    youtubeTabId = tab.id;

    const videoId = extractVideoId(tab.url);

    if (videoId) {
      currentVideoUrl = tab.url;

      try {
        // Route through background script for reliable message passing
        const result = await chrome.runtime.sendMessage({
          action: "relayToContent",
          payload: { action: "getVideoInfo" },
        });
        debugLog("[YouTube Digest Panel] getVideoInfo result:", result);
        if (result.success && result.response) {
          currentVideoTitle = result.response.title || "";
          currentChannelName = result.response.channelName || "";
          currentVideoDescription = result.response.description || "";
          currentVideoDuration = result.response.duration || 0;
        }
      } catch (e) {
        console.error("[YouTube Digest Panel] getVideoInfo error:", e);
        currentVideoTitle = "";
        currentChannelName = "";
        currentVideoDescription = "";
        currentVideoDuration = 0;
      }

      startDigest(videoId, tab.url);
    } else {
      showState("welcome");
    }
  } catch (error) {
    console.error("Tab check error:", error);
    showState("welcome");
  }
}

function extractVideoId(url) {
  try {
    const urlObj = new URL(url);

    if (
      urlObj.hostname.includes("youtube.com") &&
      urlObj.searchParams.has("v")
    ) {
      return urlObj.searchParams.get("v");
    }

    if (urlObj.hostname === "youtu.be") {
      return urlObj.pathname.slice(1);
    }

    if (urlObj.pathname.startsWith("/embed/")) {
      return urlObj.pathname.split("/")[2];
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// DIGEST PIPELINE
// ============================================================

async function startDigest(videoId, videoUrl) {
  // Check if we already have this video loaded in memory
  if (videoId === currentVideoId && currentAnalysis) {
    showState("results");
    return;
  }

  // Every video change invalidates observer work and in-flight translations.
  if (videoId !== currentVideoId) {
    translationGeneration += 1;
    analysisGeneration += 1;
    notesRequestGeneration += 1;
    invalidateExplanationPresentation();
    stopTranscriptTranslationSession();
  }

  // Check cache for this video
  const cached = await loadFromCache(videoId);
  if (cached) {
    debugLog("Loading from cache:", videoId);
    currentVideoId = videoId;
    currentVideoUrl = videoUrl;
    currentAnalysis = cached.analysis || null;
    currentTranscript = cached.transcript;
    currentTranscriptText = cached.transcriptText;
    currentTranscriptTimestamped = cached.transcriptTimestamped;
    currentTranscriptLanguage = cached.transcriptLanguage || null;
    isAnalysisLoading = false;

    // Restore semantic-segment translations from persistent storage.
    if (cached.paragraphCache) {
      for (const [key, value] of Object.entries(cached.paragraphCache)) {
        transcriptParagraphCache.set(key, value);
      }
    }

    if (currentVideoTitle || currentChannelName) {
      const videoInfo = document.getElementById("videoInfo");
      document.getElementById("videoTitle").textContent = currentVideoTitle;
      document.getElementById("videoChannel").textContent = currentChannelName;
      videoInfo.style.display = "block";
    }

    // Always render transcript first
    renderTranscript();

    // Render analysis if we have it cached
    if (currentAnalysis) {
      renderAnalysisResults(currentAnalysis);
      highlightMomentsOnPage(currentAnalysis.keyMoments);
    }

    showState("results");
    document.getElementById("tabsNav").style.display = "flex";

    // Load notes for this video
    loadNotes(videoId);

    // Setup explain feature
    setupExplainFeature();
    if (currentTranscriptMode !== "original") translateTranscript();
    return;
  }

  currentVideoId = videoId;
  currentVideoUrl = videoUrl;
  currentAnalysis = null;
  currentTranscript = null;
  currentTranscriptText = null;
  currentTranscriptTimestamped = null;
  currentTranscriptLanguage = null;
  isAnalysisLoading = false;

  if (currentVideoTitle || currentChannelName) {
    const videoInfo = document.getElementById("videoInfo");
    document.getElementById("videoTitle").textContent = currentVideoTitle;
    document.getElementById("videoChannel").textContent = currentChannelName;
    videoInfo.style.display = "block";
  }

  showState("loading");
  updateLoading(t("sidepanel.loadingTranscript"), "");

  const transcriptResult = await chrome.runtime.sendMessage({
    action: "fetchTranscript",
    videoId: videoId,
  });

  if (!transcriptResult.success) {
    if (transcriptResult.error === "NO_SUPADATA_KEY") {
      showConfigError({ hasSupadataKey: false, hasAiKey: true });
      return;
    }
    showError(
      t("sidepanel.noTranscript"),
      localizeServiceError(transcriptResult.error),
    );
    return;
  }

  currentTranscript = transcriptResult.transcript;
  currentTranscriptText = transcriptResult.transcriptText;
  currentTranscriptTimestamped = transcriptResult.transcriptTextTimestamped;
  currentTranscriptLanguage = transcriptResult.language || null;

  // Render transcript immediately (no LLM needed)
  renderTranscript();
  showState("results");
  document.getElementById("tabsNav").style.display = "flex";

  // Load notes for this video
  loadNotes(videoId);

  // Setup explain feature for text selection
  setupExplainFeature();
  if (currentTranscriptMode !== "original") translateTranscript();

  // Save transcript to cache (without analysis)
  await saveToCache(videoId);

  // DON'T run LLM analysis automatically - wait for user to click Overview tab
  // This saves tokens when user just wants to see the transcript
}

// ============================================================
// RENDERING
// ============================================================

/**
 * Renders the analysis results into the Overview tab.
 * Shows chapters and key quotes only.
 */
function renderAnalysisResults(analysis) {
  const chapters = Array.isArray(analysis.chapters) ? analysis.chapters : [];
  const keyQuotes = Array.isArray(analysis.keyQuotes) ? analysis.keyQuotes : [];
  setOverviewLoadingIndicators(false);
  renderOverviewStatus("success");

  // Chapters
  const chapterList = document.getElementById("chapterList");
  chapterList.innerHTML = "";
  chapters.forEach((chapter) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    li.dataset.seconds = chapter.timestampSeconds;
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute(
      "aria-label",
      t("overview.playFromTitle", {
        timestamp: chapter.timestamp,
        title: chapter.title,
      }),
    );
    li.innerHTML = `
      <span class="chapter-timestamp">${escapeHtml(chapter.timestamp)}</span>
      <div class="chapter-content">
        <span class="chapter-title">${escapeHtml(chapter.title)}</span>
        <span class="chapter-summary">${escapeHtml(chapter.summary || "")}</span>
      </div>
    `;
    const seekToChapter = () => {
      setSelectedOverviewChapter(li);
      debugLog(
        "[YouTube Digest Panel] Chapter clicked:",
        chapter.timestamp,
        chapter.timestampSeconds,
      );
      seekTo(chapter.timestampSeconds);
    };
    li.addEventListener("click", seekToChapter);
    li.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      seekToChapter();
    });
    chapterList.appendChild(li);
  });
  if (!chapters.length) {
    chapterList.innerHTML =
      `<li class="overview-empty" role="status"><span aria-hidden="true">○</span>${escapeHtml(t("overview.noChapters"))}</li>`;
  }

  // Quotes - sort by timestamp (chronological order)
  const quotesList = document.getElementById("quotesList");
  quotesList.innerHTML = "";
  const sortedQuotes = [...keyQuotes].sort(
    (a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0),
  );
  sortedQuotes.forEach((quote) => {
    const div = document.createElement("div");
    div.className = "quote-item";
    div.dataset.seconds = quote.timestampSeconds;
    div.innerHTML = `
      <div class="quote-text">${escapeHtml(quote.quote)}</div>
      <div class="quote-meta">
        <button class="quote-timestamp" type="button" aria-label="${escapeHtml(t("transcript.playFrom", { timestamp: quote.timestamp }))}">${escapeHtml(quote.timestamp)}</button>
        <div class="quote-actions">
          <div class="quote-action">
            <button class="quote-save-note-btn" type="button" title="${escapeHtml(t("overview.saveQuoteTitle"))}" aria-label="${escapeHtml(t("overview.saveQuoteTitle"))}">
              <svg class="lucide lucide-bookmark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              ${escapeHtml(t("overview.saveQuote"))}
            </button>
            <span class="action-feedback quote-action-feedback" role="status" aria-live="polite" aria-atomic="true" hidden></span>
          </div>
          <div class="quote-action">
            <button class="quote-copy-btn" type="button" title="${escapeHtml(t("overview.copyQuoteTitle"))}" aria-label="${escapeHtml(t("overview.copyQuoteTitle"))}">
              <svg class="lucide lucide-copy" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              ${escapeHtml(t("overview.copyQuote"))}
            </button>
            <span class="action-feedback quote-action-feedback" role="status" aria-live="polite" aria-atomic="true" hidden></span>
          </div>
        </div>
      </div>
    `;
    div.addEventListener("click", () => {
      debugLog(
        "[YouTube Digest Panel] Quote clicked:",
        quote.timestamp,
        quote.timestampSeconds,
      );
      seekTo(quote.timestampSeconds);
    });

    const quoteCopyBtn = div.querySelector(".quote-copy-btn");
    quoteCopyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (quoteCopyBtn.disabled) return;
      setLocalActionFeedback(quoteCopyBtn, {
        state: "pending",
        label: t("overview.copying"),
        message: t("overview.copyingQuote"),
        ariaLabel: t("overview.copyingQuote"),
      });
      try {
        await navigator.clipboard.writeText(quote.quote);
        if (!quoteCopyBtn.isConnected) return;
        setLocalActionFeedback(quoteCopyBtn, {
          state: "success",
          label: `✓ ${t("overview.copied")}`,
          message: t("overview.quoteCopied"),
          ariaLabel: t("overview.quoteCopiedAria"),
        });
      } catch (err) {
        console.error("Copy failed:", err);
        if (!quoteCopyBtn.isConnected) return;
        setLocalActionFeedback(quoteCopyBtn, {
          state: "error",
          label: t("overview.retryCopy"),
          message: t("overview.copyQuoteFailed"),
          ariaLabel: t("overview.retryCopyQuote"),
        });
      }
    });

    const quoteSaveNoteBtn = div.querySelector(".quote-save-note-btn");
    quoteSaveNoteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveQuoteAsNote(quote, quoteSaveNoteBtn);
    });

    quotesList.appendChild(div);
  });
  if (!sortedQuotes.length) {
    quotesList.innerHTML =
      `<div class="overview-empty" role="status"><span aria-hidden="true">○</span>${escapeHtml(t("overview.noQuotes"))}</div>`;
  }
}

/**
 * Keeps the selected Overview chapter explicit after a timestamp jump. This
 * is independent from transcript playback-following, which intentionally
 * remains scoped to the Transcript tab.
 */
function setSelectedOverviewChapter(selectedChapter) {
  document.querySelectorAll(".chapter-item.is-selected").forEach((chapter) => {
    chapter.classList.remove("is-selected");
    chapter.removeAttribute("aria-current");
    const timestamp = chapter.querySelector(".chapter-timestamp")?.textContent;
    const title = chapter.querySelector(".chapter-title")?.textContent;
    chapter.setAttribute(
      "aria-label",
      t("overview.playFromTitle", { timestamp, title }),
    );
  });

  selectedChapter.classList.add("is-selected");
  selectedChapter.setAttribute("aria-current", "true");
  const timestamp = selectedChapter.querySelector(".chapter-timestamp")?.textContent;
  const title = selectedChapter.querySelector(".chapter-title")?.textContent;
  selectedChapter.setAttribute(
    "aria-label",
    t("overview.currentlySelected", { timestamp, title }),
  );
}

/**
 * Keeps local action feedback in its initiating card. Results persist until a
 * subsequent action, a render, or the card lifecycle replaces them; no timer
 * is used to claim that a copy or save state has changed.
 */
function setLocalActionFeedback(
  button,
  { state, label, message, ariaLabel, manualCopyText = "" },
) {
  button.dataset.feedbackState = state;
  button.disabled = state === "pending";
  button.setAttribute("aria-busy", String(state === "pending"));
  button.setAttribute("aria-label", ariaLabel || label);
  const labelElement = button.querySelector(".note-action-label");
  if (labelElement) {
    labelElement.textContent = label;
  } else {
    button.textContent = label;
  }

  const feedback = button
    .closest(".quote-action, .note-action")
    ?.querySelector(".action-feedback");
  if (!feedback) return;

  feedback.replaceChildren();
  feedback.hidden = !message;
  feedback.dataset.feedbackState = state;
  if (!message) return;

  feedback.append(document.createTextNode(message));
  if (manualCopyText) {
    const manualCopy = document.createElement("span");
    manualCopy.className = "manual-copy-value";
    manualCopy.textContent = manualCopyText;
    feedback.append(manualCopy);
  }
}

/**
 * Saves a key quote as a timestamped note.
 */
async function saveQuoteAsNote(quote, btn) {
  if (!currentVideoId || btn.disabled) return;

  const requestVideoId = currentVideoId;
  const requestVideoTitle = currentVideoTitle;
  const requestChannelName = currentChannelName;
  setLocalActionFeedback(btn, {
    state: "pending",
    label: t("overview.saving"),
    message: t("overview.savingQuote"),
    ariaLabel: t("overview.savingQuote"),
  });

  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveNote",
      videoId: requestVideoId,
      timestamp: quote.timestampSeconds,
      videoTitle: requestVideoTitle,
      channelName: requestChannelName,
    });

    if (requestVideoId !== currentVideoId || !btn.isConnected) return;

    if (result?.success) {
      setLocalActionFeedback(btn, {
        state: "success",
        label: `✓ ${t("overview.saved")}`,
        message: t("overview.quoteSaved"),
        ariaLabel: t("overview.quoteSavedAria"),
      });
      // Refresh notes list if on Notes tab
      loadNotes(requestVideoId);
    } else {
      console.error(
        "[YouTube Digest] Save quote as note failed:",
        result?.error,
      );
      setLocalActionFeedback(btn, {
        state: "error",
        label: t("overview.retrySave"),
        message: result?.error
          ? t("overview.saveQuoteFailedWithError", {
              error: localizeServiceError(result.error),
            })
          : t("overview.saveQuoteFailed"),
        ariaLabel: t("overview.retrySaveQuote"),
      });
    }
  } catch (error) {
    console.error("[YouTube Digest] Save quote as note error:", error);
    if (requestVideoId !== currentVideoId || !btn.isConnected) return;
    setLocalActionFeedback(btn, {
      state: "error",
      label: t("overview.retrySave"),
      message: t("overview.saveQuoteFailed"),
      ariaLabel: t("overview.retrySaveQuote"),
    });
  }
}

/**
 * Legacy function for backwards compatibility with cached data.
 * Renders both transcript and analysis.
 */
function renderResults(analysis) {
  renderAnalysisResults(analysis);

  renderTranscript();

  document.getElementById("tabsNav").style.display = "flex";

  // Setup explain feature for text selection
  setupExplainFeature();
}

/**
 * Returns true while the user has a range of text selected.
 * Transcript row clicks must not seek in that state: the click emitted after
 * selection mouseup belongs to the selection/explain interaction, not playback.
 */
function hasNonCollapsedTextSelection() {
  const selection = window.getSelection();
  return Boolean(
    selection && selection.rangeCount > 0 && !selection.isCollapsed,
  );
}

/**
 * Preserves normal row-click seeking while keeping text selection inert.
 */
function seekFromTranscriptEntryClick(event, seconds) {
  if (hasNonCollapsedTextSelection()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  seekTo(seconds);
}

function renderTranscript() {
  if (!currentTranscript) return;

  const transcriptList = document.getElementById("transcriptList");
  transcriptList.innerHTML = "";

  // Show a small badge indicating the transcript came from the video's
  // existing subtitles. (We no longer AI-transcribe audio, so subtitles
  // are the only source.)
  renderTranscriptSourceBadge("original", transcriptList);

  // Group entries using smart sentence-boundary + time-guardrail logic
  const grouped = groupTranscriptEntries(currentTranscript);

  grouped.forEach((group) => {
    const div = document.createElement("div");
    div.className = "transcript-entry";
    div.dataset.seconds = group.start;

    const minutes = Math.floor(group.start / 60);
    const seconds = Math.floor(group.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

    div.innerHTML = `
      <button class="transcript-time" type="button" aria-label="${escapeHtml(t("transcript.playFrom", { timestamp }))}">${timestamp}</button>
      <span class="transcript-text">${renderSubtitleInlineMarkup(group.text)}</span>
    `;

    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, group.start),
    );
    transcriptList.appendChild(div);
  });

  // Start tracking video playback for auto-scroll
  startPlaybackTracking();
}

function transcriptSourceBadgeCopy(mode) {
  const original = getOriginalTranscriptLabel();
  const source = t("transcript.fromVideoSubtitles");
  if (mode === "original") return `${source} · ${original}`;
  const modeCopy =
    mode === "bilingual"
      ? t("transcript.sourceBilingual", { original })
      : t("transcript.sourceChinese", { original });
  return `${source} · ${modeCopy}`;
}

function renderTranscriptSourceBadge(mode, transcriptList) {
  const existingBadge = document.getElementById("transcriptSourceBadge");
  if (existingBadge) existingBadge.remove();
  const badge = document.createElement("div");
  badge.id = "transcriptSourceBadge";
  badge.className = "transcript-source-badge";
  badge.innerHTML = `<span class="source-dot source-dot--subs"></span> ${escapeHtml(transcriptSourceBadgeCopy(mode))}`;
  transcriptList.parentElement.insertBefore(badge, transcriptList);
}

function refreshTranscriptUiCopy() {
  const badge = document.getElementById("transcriptSourceBadge");
  if (badge) {
    badge.innerHTML = `<span class="source-dot source-dot--subs"></span> ${escapeHtml(transcriptSourceBadgeCopy(currentTranscriptMode))}`;
  }
  document.querySelectorAll(".transcript-time").forEach((button) => {
    const timestamp = button.textContent;
    button.setAttribute(
      "aria-label",
      button.closest(".transcript-entry")?.classList.contains("active-playback")
        ? t("transcript.currentlyPlaying", { timestamp })
        : t("transcript.playFrom", { timestamp }),
    );
  });
  document.querySelectorAll(".translation-pending").forEach((node) => {
    node.textContent = t("transcript.waiting");
  });
  document.querySelectorAll(".translation-error-message").forEach((node) => {
    node.textContent = t(node.dataset.i18nError || "transcript.failed");
  });
  document.querySelectorAll(".translation-retry-btn").forEach((button) => {
    button.textContent = t("transcript.retry");
  });
}

function copyTranscript() {
  copyToClipboardWithFeedback(currentTranscriptText || "", "copyTranscriptBtn");
}

function exportTranscript() {
  const transcriptContent = currentTranscriptText || "";
  const videoUrl = `https://youtube.com/watch?v=${currentVideoId}`;

  let exportText = "";
  exportText += `${t("export.transcript")}\n`;
  exportText += `${"=".repeat(60)}\n\n`;
  exportText += `${t("export.title")}: ${currentVideoTitle || t("export.unknown")}\n`;
  exportText += `${t("export.channel")}: ${currentChannelName || t("export.unknown")}\n`;
  exportText += `${t("export.url")}: ${videoUrl}\n`;
  exportText += `\n${"—".repeat(60)}\n\n`;

  if (currentVideoDescription) {
    exportText += `${t("export.description")}:\n${currentVideoDescription}\n`;
    exportText += `\n${"—".repeat(60)}\n\n`;
  }

  exportText += `${t("export.transcript")}:\n\n${transcriptContent}\n`;
  exportText += `\n${"—".repeat(60)}\n`;
  exportText += `${t("export.credit")}\n`;

  const filename = `${sanitizeFilename(currentVideoTitle)}-transcript.txt`;
  downloadTextFile(exportText, filename);
}

// ============================================================
// UI STATE MANAGEMENT
// ============================================================

function setTranscriptToolbarVisibility(visible) {
  const toolbar = document.getElementById("transcriptToolbar");
  if (toolbar) toolbar.hidden = !visible;
}

function showState(state) {
  if (state !== "error") visibleError = null;
  document.getElementById("welcomeState").style.display =
    state === "welcome" ? "flex" : "none";
  document.getElementById("loadingState").style.display =
    state === "loading" ? "block" : "none";
  document.getElementById("errorState").style.display =
    state === "error" ? "block" : "none";
  const uploadEl = document.getElementById("uploadState");
  if (uploadEl) uploadEl.style.display = "none"; // Upload state removed — always hidden
  document.getElementById("resultsState").style.display =
    state === "results" ? "block" : "none";

  // The tab bar only belongs on the results view. We toggle it HERE, in one
  // place, so it tracks the view automatically. Previously each caller had to
  // remember to re-show it after showState("results"), and one path forgot —
  // which is why the tabs could vanish when re-opening an already-analyzed video.
  document.getElementById("tabsNav").style.display =
    state === "results" ? "flex" : "none";

  const activeTab = document.querySelector(".tab.active")?.dataset.tab;
  setTranscriptToolbarVisibility(
    state === "results" && activeTab === "transcript",
  );

  if (state !== "results") {
    stopPlaybackTracking();
  }
}

function updateLoading(title, subtitle) {
  document.getElementById("loadingText").textContent = title;
  document.getElementById("loadingSubtext").textContent = subtitle;
}

function showError(title, message) {
  visibleError = { kind: "generic", title, message };
  renderError(title, message);
}

function localizeServiceError(errorCode) {
  const keys = {
    NO_TRANSCRIPT: "sidepanel.noTranscript",
    INVALID_SUPADATA_KEY: "sidepanel.invalidSupadataKey",
    RATE_LIMITED: "sidepanel.rateLimited",
    NO_AI_KEY: "sidepanel.apiKeysMissing",
  };
  return t(keys[errorCode] || "sidepanel.unknownError");
}

function renderError(title, message) {
  errorAction = null;
  showState("error");
  document.getElementById("errorTitle").textContent = title;
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("errorBtn").textContent = t("sidepanel.retry");
}

function showConfigError(configStatus) {
  visibleError = { kind: "config", configStatus };
  renderConfigError(configStatus);
}

function renderConfigError(configStatus) {
  const missingKeys = [];
  if (!configStatus.hasSupadataKey) missingKeys.push("Supadata");
  if (!configStatus.hasAiKey)
    missingKeys.push(currentUiLanguage === "zh-CN" ? "AI 服务" : "AI provider");

  showState("error");
  document.getElementById("errorTitle").textContent = t("sidepanel.apiKeysMissing");
  document.getElementById("errorMessage").textContent = t(
    "sidepanel.configureKeys",
    { providers: missingKeys.join(currentUiLanguage === "zh-CN" ? "和" : " and ") },
  );
  document.getElementById("errorBtn").textContent = t(
    "sidepanel.openSettingsAction",
  );
  errorAction = () => chrome.runtime.sendMessage({ action: "openOptions" });
}

// ============================================================
// TAB SWITCHING
// ============================================================

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const active = panel.dataset.panel === tabName;
    panel.classList.toggle("active", active);
    panel.setAttribute("aria-hidden", String(!active));
  });

  setTranscriptToolbarVisibility(tabName === "transcript");

  // Start/stop playback tracking based on which tab is active
  if (tabName === "transcript") {
    startPlaybackTracking();
    if (currentTranscriptMode !== "original" && !activeTranslationQueue) {
      translateTranscript();
    }
  } else {
    stopTranscriptTranslationSession();
    stopPlaybackTracking();
  }

  // Lazy-load LLM analysis when user switches to Overview tab
  if (tabName === "overview" && !currentAnalysis && !isAnalysisLoading) {
    triggerAnalysis();
  }
}

function renderOverviewStatus(state, message = "") {
  const panel = document.getElementById("panelOverview");
  const status = document.getElementById("overviewStatus");
  if (!panel || !status) return;

  panel.dataset.overviewState = state;
  status.className = `overview-status overview-status--${state}`;
  status.replaceChildren();

  // Loading feedback belongs with the two result regions. Keeping this status
  // node out of the visual flow prevents a page-level banner from pushing the
  // Chapters and Key Quotes headings away from their placeholders.
  if (state === "success" || state === "loading") {
    status.hidden = true;
    return;
  }

  status.hidden = false;
  const icon = document.createElement("span");
  icon.className = "overview-status-icon";
  icon.setAttribute("aria-hidden", "true");
  const content = document.createElement("div");
  const heading = document.createElement("strong");
  const copy = document.createElement("p");
  content.append(heading, copy);
  status.append(icon, content);

  if (state === "error") {
    icon.textContent = "!";
    heading.textContent = t("overview.unavailableTitle");
    copy.textContent = message || t("overview.unavailableMessage");
    const retry = document.createElement("button");
    retry.className = "overview-retry-btn";
    retry.type = "button";
    retry.textContent = t("overview.retry");
    retry.addEventListener("click", triggerAnalysis);
    content.append(retry);
    return;
  }

  icon.textContent = "○";
  heading.textContent = t("overview.readyTitle");
  copy.textContent = t("overview.readyMessage");
}

function setOverviewLoadingIndicators(isLoading) {
  const chapterList = document.getElementById("chapterList");
  const quotesList = document.getElementById("quotesList");
  const chapterIndicator = document.getElementById("chaptersLoadingIndicator");
  const quotesIndicator = document.getElementById("quotesLoadingIndicator");

  if (chapterIndicator) chapterIndicator.hidden = !isLoading;
  if (quotesIndicator) quotesIndicator.hidden = !isLoading;
  [chapterList, quotesList].forEach((region) => {
    if (!region) return;
    region.toggleAttribute("aria-busy", isLoading);
    if (isLoading) region.replaceChildren();
  });
}

/**
 * Triggers the LLM analysis (lazy-loaded when user clicks Overview or Quotes tab).
 * This saves tokens by not running analysis until needed.
 */
async function triggerAnalysis() {
  if (!currentTranscriptTimestamped || isAnalysisLoading || currentAnalysis)
    return;

  isAnalysisLoading = true;
  const requestGeneration = analysisGeneration;

  // The visual state starts only after the existing lazy request starts.
  renderOverviewStatus("loading");
  setOverviewLoadingIndicators(true);

  try {
    const analysisResult = await chrome.runtime.sendMessage({
      action: "analyzeTranscript",
      transcriptText: currentTranscriptTimestamped,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      videoDescription: currentVideoDescription,
      videoDuration: currentVideoDuration,
    });

    if (requestGeneration !== analysisGeneration) return;

    if (!analysisResult.success) {
      setOverviewLoadingIndicators(false);
      renderOverviewStatus(
        "error",
        analysisResult.error
          ? localizeServiceError(analysisResult.error)
          : t("sidepanel.aiUnavailable"),
      );
      return;
    }

    currentAnalysis = analysisResult.analysis;
    renderAnalysisResults(currentAnalysis);
    highlightMomentsOnPage(currentAnalysis.keyMoments);

    // Save to cache now that we have analysis
    await saveToCache(currentVideoId);
  } catch (error) {
    if (requestGeneration !== analysisGeneration) return;
    console.error("[YouTube Digest Panel] Analysis error:", error);
    setOverviewLoadingIndicators(false);
    renderOverviewStatus("error", t("sidepanel.aiUnavailable"));
  } finally {
    if (requestGeneration === analysisGeneration) isAnalysisLoading = false;
  }
}

// ============================================================
// TIMESTAMP / SEEK
// ============================================================

async function seekTo(seconds) {
  debugLog("[YouTube Digest Panel] seekTo called with:", seconds);
  if (seconds === undefined || seconds === null) {
    debugLog("[YouTube Digest Panel] seekTo aborted - no seconds value");
    return;
  }

  const payload = {
    action: "seekTo",
    seconds: Number(seconds),
  };

  try {
    // Try direct messaging to the stored YouTube tab first (fastest/reliable)
    if (youtubeTabId) {
      try {
        await chrome.tabs.sendMessage(youtubeTabId, payload);
        debugLog("[YouTube Digest Panel] seekTo direct success");
        return;
      } catch (directErr) {
        debugLog(
          "[YouTube Digest Panel] Direct seekTo failed, falling back to relay:",
          directErr.message,
        );
      }
    }

    // Fallback: route through background script
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload,
    });
    debugLog("[YouTube Digest Panel] seekTo relay result:", result);
  } catch (error) {
    console.error("[YouTube Digest Panel] seekTo error:", error);
  }
}

/**
 * Plays a saved note at its timestamp.
 * - If the note belongs to the video currently open, we seek the player in place.
 * - If it belongs to a DIFFERENT video (e.g. viewing "All Notes"), seeking the
 *   current player would jump to the wrong content, so we open that video in a
 *   new tab at the right timestamp instead.
 */
function playNote(note) {
  if (note.videoId && note.videoId === currentVideoId) {
    seekTo(note.timestampSeconds);
  } else {
    // note.timestampedUrl already includes the &t=<seconds>s anchor
    chrome.tabs.create({ url: note.timestampedUrl });
  }
}

async function highlightMomentsOnPage(moments) {
  if (!moments || !moments.length) return;

  try {
    // Route through background script for reliable message passing
    await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: {
        action: "highlightMoments",
        moments: moments,
        videoDuration: currentVideoDuration,
      },
    });
  } catch (error) {
    console.error("Highlight error:", error);
  }
}

// ============================================================
// UTILITY
// ============================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

/**
 * Renders the small subset of inline formatting commonly present in subtitle
 * tracks and model translations. Everything is escaped first; only exact,
 * attribute-free allowlisted tags are restored as markup afterwards.
 */
function renderSubtitleInlineMarkup(text) {
  return escapeHtml(text).replace(
    /&lt;(\/?)(i|em|b|strong|u)&gt;|&lt;br(?:\s*\/)?&gt;/gi,
    (_match, closing, tagName) =>
      tagName ? `<${closing}${tagName.toLowerCase()}>` : "<br>",
  );
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Copy failed:", error);
    return false;
  }
}

async function copyToClipboardWithFeedback(text, buttonId) {
  const btn = document.getElementById(buttonId);
  if (!btn || btn.disabled) return;

  btn.dataset.feedbackState = "pending";
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.setAttribute("aria-label", t("sidepanel.copyingTranscript"));
  btn.title = t("sidepanel.copyingTranscript");

  const success = await copyToClipboard(text);
  btn.disabled = false;
  btn.setAttribute("aria-busy", "false");
  if (success) {
    btn.dataset.feedbackState = "success";
    btn.setAttribute("aria-label", t("sidepanel.transcriptCopied"));
    btn.title = t("sidepanel.transcriptCopied");
    return;
  }

  btn.dataset.feedbackState = "error";
  btn.setAttribute("aria-label", t("sidepanel.retryCopyTranscript"));
  btn.title = t("sidepanel.retryCopyTranscript");
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(str) {
  return (str || "untitled")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50)
    .toLowerCase();
}

// ============================================================
// TEXT SELECTION — EXPLAIN FEATURE
// ============================================================

/**
 * Sets up text selection handling in the transcript.
 * When user selects text, shows an "Explain" button.
 */
function setupExplainFeature() {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  // Each transcript owns one selection listener. Replacing an older listener
  // prevents stale transcript DOM from offering a second Explain entry.
  explainSelectionCleanup?.();

  // Create the explain tooltip/button
  const tooltip = document.createElement("div");
  tooltip.id = "explainTooltip";
  tooltip.className = "explain-tooltip";
  tooltip.innerHTML = `<button class="explain-btn" type="button">💡 ${escapeHtml(t("explain.action"))}</button>`;
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  let selectedText = "";

  // Interacting with Explain must preserve the transcript selection and stay
  // isolated from document/row click behavior.
  tooltip.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  tooltip.addEventListener("mouseup", (event) => {
    event.stopPropagation();
  });
  tooltip.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  // Listen for text selection
  const handleSelectionMouseUp = () => {
    const selection = window.getSelection();
    if (!selection) {
      tooltip.style.display = "none";
      return;
    }
    const text = selection.toString().trim();

    // Only show if selecting within transcript
    const isInTranscript =
      selection.rangeCount > 0 && transcriptList.contains(selection.anchorNode);

    // Allow any selection length (removed 10+ char requirement)
    if (text.length > 0 && isInTranscript) {
      selectedText = text;

      // Position the tooltip near the selection
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      tooltip.style.display = "block";
      tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
    } else {
      tooltip.style.display = "none";
    }
  };

  // Hide tooltip when clicking elsewhere
  const hideTooltipOnOutsidePointer = (e) => {
    if (!tooltip.contains(e.target)) {
      tooltip.style.display = "none";
    }
  };
  document.addEventListener("mouseup", handleSelectionMouseUp);
  document.addEventListener("mousedown", hideTooltipOnOutsidePointer);

  const cleanup = () => {
    document.removeEventListener("mouseup", handleSelectionMouseUp);
    document.removeEventListener("mousedown", hideTooltipOnOutsidePointer);
    tooltip.remove();
    if (explainSelectionCleanup === cleanup) explainSelectionCleanup = null;
  };
  explainSelectionCleanup = cleanup;

  // Handle explain button click
  tooltip
    .querySelector(".explain-btn")
    .addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedText) return;

      tooltip.style.display = "none";
      await showExplanation(selectedText);
    });
}

/**
 * Ends only the visual Explain presentation. The background request continues
 * unchanged, but a response can no longer write into a closed or old modal.
 */
function invalidateExplanationPresentation() {
  explanationGeneration += 1;
  document.getElementById("explainModal")?.remove();
  explainSelectionCleanup?.();
}

function closeExplanationPresentation(modal) {
  explanationGeneration += 1;
  if (modal?.isConnected) modal.remove();
}

/**
 * Shows the explanation modal and fetches it from the configured AI provider.
 */
async function showExplanation(selectedText) {
  // A new selection replaces only the old visual surface. It does not cancel
  // the existing explainSelection message or change its request contract.
  document.getElementById("explainModal")?.remove();

  // Create modal
  const modal = document.createElement("div");
  modal.id = "explainModal";
  modal.className = "explain-modal-overlay";
  modal.innerHTML = `
    <div class="explain-modal" role="dialog" aria-modal="true" aria-labelledby="explainModalTitle" aria-describedby="explanationContent">
      <div class="explain-modal-header">
        <div class="explain-modal-title" id="explainModalTitle">${escapeHtml(t("explain.action"))}</div>
        <button class="explain-modal-close" id="closeExplain" type="button" aria-label="${escapeHtml(t("explain.close"))}" title="${escapeHtml(t("explain.close"))}">✕</button>
      </div>
      <div class="explain-selected-text">"${escapeHtml(selectedText.substring(0, 200))}${selectedText.length > 200 ? "..." : ""}"</div>
      <div class="explain-modal-content" id="explanationContent"></div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector(".explain-modal-close")?.focus();

  // Closing changes only this visual presentation, never the request itself.
  modal
    .querySelector(".explain-modal-close")
    .addEventListener("click", () => closeExplanationPresentation(modal));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeExplanationPresentation(modal);
  });

  // Get some context around the selection from the transcript
  return requestExplanation(modal, {
    selectedText,
    transcriptContext: getTranscriptContext(selectedText),
    videoTitle: currentVideoTitle,
    videoId: currentVideoId,
  });
}

function explanationPresentationIsCurrent(modal, requestGeneration, videoId) {
  return (
    modal?.isConnected &&
    requestGeneration === explanationGeneration &&
    videoId === currentVideoId
  );
}

function renderExplanationState(modal, state, { explanation = "", error = "", retry } = {}) {
  const contentDiv = modal?.querySelector("#explanationContent");
  if (!contentDiv) return;

  modal.dataset.explanationState = state;
  contentDiv.replaceChildren();

  if (state === "loading") {
    const loading = document.createElement("div");
    loading.className = "explain-loading";
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.setAttribute("aria-atomic", "true");
    const indicator = document.createElement("span");
    indicator.className = "explain-loading-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = "…";
    const copy = document.createElement("span");
    copy.textContent = t("explain.loading");
    loading.append(indicator, copy);
    contentDiv.append(loading);
    return;
  }

  if (state === "success") {
    const explanationText = document.createElement("div");
    explanationText.className = "explain-text";
    String(explanation || "")
      .split(/\n{2,}/)
      .forEach((paragraphText) => {
        const paragraph = document.createElement("p");
        const lines = paragraphText.split("\n");
        lines.forEach((line, index) => {
          if (index > 0) paragraph.append(document.createElement("br"));
          paragraph.append(document.createTextNode(line));
        });
        explanationText.append(paragraph);
      });
    contentDiv.append(explanationText);
    return;
  }

  const failure = document.createElement("div");
  failure.className = "explain-error";
  failure.setAttribute("role", "alert");
  const title = document.createElement("strong");
  title.textContent = t("explain.unavailable");
  const message = document.createElement("p");
  message.textContent = error || t("explain.retryMessage");
  const retryButton = document.createElement("button");
  retryButton.className = "explain-retry-btn";
  retryButton.type = "button";
  retryButton.textContent = t("explain.retry");
  retryButton.addEventListener("click", retry);
  failure.append(title, message, retryButton);
  contentDiv.append(failure);
}

async function requestExplanation(modal, request) {
  const requestGeneration = ++explanationGeneration;
  renderExplanationState(modal, "loading");

  try {
    const result = await chrome.runtime.sendMessage({
      action: "explainSelection",
      selectedText: request.selectedText,
      transcriptContext: request.transcriptContext,
      videoTitle: request.videoTitle,
    });

    if (!explanationPresentationIsCurrent(modal, requestGeneration, request.videoId))
      return;

    if (result?.success) {
      renderExplanationState(modal, "success", {
        explanation: result.explanation,
      });
      return;
    }

    renderExplanationState(modal, "error", {
      error: result?.error
        ? localizeServiceError(result.error)
        : t("explain.failed"),
      retry: () => requestExplanation(modal, request),
    });
  } catch (error) {
    if (!explanationPresentationIsCurrent(modal, requestGeneration, request.videoId))
      return;
    renderExplanationState(modal, "error", {
      error: t("explain.failed"),
      retry: () => requestExplanation(modal, request),
    });
  }
}

/**
 * Gets surrounding context from the transcript for the selected text.
 */
function getTranscriptContext(selectedText) {
  const fullText = currentTranscriptText || "";
  const index = fullText.indexOf(selectedText);

  if (index === -1) return "";

  // Get 200 chars before and after
  const start = Math.max(0, index - 200);
  const end = Math.min(fullText.length, index + selectedText.length + 200);

  return fullText.substring(start, end);
}

// ============================================================
// CACHING
// ============================================================

/**
 * Saves the current digest results to persistent local storage.
 * Results survive browser restarts — reopening the same video loads from cache
 * without consuming API tokens or Supadata calls.
 * Cache expires after 30 days. Oldest entries evicted when > 20 videos cached.
 */
async function saveToCache(videoId) {
  if (!videoId || !currentTranscript) return;

  try {
    // Persist semantic-segment translations for this video.
    const paragraphCacheForVideo = {};
    for (const [key, value] of transcriptParagraphCache.entries()) {
      if (key.startsWith(`${videoId}:`)) {
        paragraphCacheForVideo[key] = value;
      }
    }

    const cacheData = {
      analysis: currentAnalysis, // May be null if not yet analyzed
      transcript: currentTranscript,
      transcriptText: currentTranscriptText,
      transcriptTimestamped: currentTranscriptTimestamped,
      transcriptLanguage: currentTranscriptLanguage,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      paragraphCache: paragraphCacheForVideo,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [`digest_${videoId}`]: cacheData });
    debugLog(
      "Saved to cache:",
      videoId,
      currentAnalysis ? "(with analysis)" : "(transcript only)",
    );

    // Evict old entries if we have more than 20 videos cached
    await evictOldCacheEntries(20);
  } catch (error) {
    console.error("Cache save error:", error);
  }
}

/**
 * Keeps the cache from growing unbounded.
 * Removes the oldest entries when we exceed maxEntries videos.
 *
 * @param {number} maxEntries - Maximum number of cached videos to keep
 */
async function evictOldCacheEntries(maxEntries) {
  try {
    const allData = await chrome.storage.local.get(null);
    let digestKeys = Object.keys(allData).filter((k) =>
      k.startsWith("digest_"),
    );
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const expired = digestKeys.filter((key) => {
      const timestamp = Number(allData[key]?.timestamp) || 0;
      return Date.now() - timestamp > THIRTY_DAYS;
    });
    if (expired.length) {
      await chrome.storage.local.remove(expired);
      const expiredSet = new Set(expired);
      digestKeys = digestKeys.filter((key) => !expiredSet.has(key));
    }

    if (digestKeys.length <= maxEntries) return;

    // Sort by timestamp (oldest first) and remove excess
    const sorted = digestKeys
      .map((k) => ({ key: k, ts: allData[k]?.timestamp || 0 }))
      .sort((a, b) => a.ts - b.ts);

    const toRemove = sorted
      .slice(0, sorted.length - maxEntries)
      .map((e) => e.key);
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      debugLog(`[YouTube Digest] Evicted ${toRemove.length} old cache entries`);
    }
  } catch (error) {
    console.error("Cache eviction error:", error);
  }
}

/**
 * Loads digest results from persistent local storage.
 * Returns null if not cached or expired (30-day expiry).
 */
async function loadFromCache(videoId) {
  if (!videoId) return null;

  try {
    const result = await chrome.storage.local.get(`digest_${videoId}`);
    const cached = result[`digest_${videoId}`];

    if (!cached) return null;

    // Cache expires after 30 days
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - cached.timestamp > THIRTY_DAYS) {
      await chrome.storage.local.remove(`digest_${videoId}`);
      return null;
    }

    return cached;
  } catch (error) {
    console.error("Cache load error:", error);
    return null;
  }
}

// ============================================================
// NOTES
// ============================================================

/**
 * Loads and renders notes from storage.
 * @param {string|null} videoId - Filter by video ID, or null for all notes
 */
async function loadNotes(videoId) {
  const requestGeneration = ++notesRequestGeneration;
  try {
    const result = await chrome.runtime.sendMessage({
      action: "getNotes",
      videoId: videoId,
    });

    // A filter switch or video change may have started a newer request while
    // this storage response was pending. Keep its data from replacing the
    // current Notes surface without altering the existing getNotes request.
    if (requestGeneration !== notesRequestGeneration) return;

    if (result?.success) {
      renderNotes(result.notes, videoId);
    }
  } catch (error) {
    if (requestGeneration !== notesRequestGeneration) return;
    console.error("[YouTube Digest Panel] Load notes error:", error);
  }
}

/**
 * Renders the notes list in the Notes tab.
 */
function renderNotes(notes, filteredVideoId) {
  const notesList = document.getElementById("notesList");
  const notesIntro = document.getElementById("notesIntro");

  if (!notesList) return;

  renderedNotes = Array.isArray(notes) ? notes : [];
  renderedNotesFilter = filteredVideoId;

  notesList.innerHTML = "";

  if (!notes || notes.length === 0) {
    notesIntro.style.display = "block";
    const emptyMessage = filteredVideoId
      ? t("notes.noneForVideo")
      : t("notes.none");
    notesIntro.innerHTML = `${emptyMessage}
      <svg class="lucide lucide-notebook-pen notes-intro-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M2 6h4" />
        <path d="M2 10h4" />
        <path d="M2 14h4" />
        <path d="M2 18h4" />
        <rect width="16" height="20" x="4" y="2" rx="2" />
        <path d="M15.5 7.5 18 10" />
        <path d="M14 14.5 12 17l2.5-2" />
        <path d="m18.5 7.5-4.1 4.1a2.12 2.12 0 0 0-.5.8l-.7 2.2 2.2-.7a2.12 2.12 0 0 0 .8-.5l4.1-4.1a1.5 1.5 0 0 0-2.1-2.1Z" />
      </svg>
      ${escapeHtml(t("notes.noneSuffix"))}`;
    return;
  }

  notesIntro.style.display = "none";

  notes.forEach((note) => {
    const noteEl = document.createElement("div");
    noteEl.className = "note-item";
    noteEl.innerHTML = `
      <div class="note-header">
        <button class="note-timestamp" type="button" aria-label="${escapeHtml(t("notes.openAt", { timestamp: note.timestamp }))}" data-url="${escapeHtml(note.timestampedUrl)}" data-seconds="${Number(note.timestampSeconds) || 0}">${escapeHtml(note.timestamp)}</button>
        ${!filteredVideoId ? `<span class="note-video-title">${escapeHtml(note.videoTitle)}</span>` : ""}
        <button class="note-delete" type="button" data-id="${escapeHtml(note.id)}" title="${escapeHtml(t("notes.delete"))}" aria-label="${escapeHtml(t("notes.delete"))}">✕</button>
      </div>
      <div class="note-text">"${escapeHtml(note.text)}"</div>
      <div class="note-actions">
        <div class="note-action">
          <button class="note-action-btn note-copy-text" type="button">
            <svg class="lucide lucide-copy" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <span class="note-action-label">${escapeHtml(t("notes.copyText"))}</span>
          </button>
          <span class="action-feedback note-action-feedback" role="status" aria-live="polite" aria-atomic="true" hidden></span>
        </div>
        <div class="note-action">
          <button class="note-action-btn note-copy-link" type="button" data-url="${escapeHtml(note.timestampedUrl)}">
            <svg class="lucide lucide-link" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M10 13a5 5 0 0 0 7.07.07l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.07-.07l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span class="note-action-label">${escapeHtml(t("notes.copyTimestamp"))}</span>
          </button>
          <span class="action-feedback note-action-feedback" role="status" aria-live="polite" aria-atomic="true" hidden></span>
        </div>
        <div class="note-action">
          <button class="note-action-btn note-play" type="button" data-seconds="${Number(note.timestampSeconds) || 0}">
            <svg class="lucide lucide-play" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span class="note-action-label">${escapeHtml(t("notes.play"))}</span>
          </button>
        </div>
      </div>
      <div class="note-feedback" role="status" aria-live="polite" aria-atomic="true" hidden></div>
    `;

    // Timestamp click - play from this point (in this tab or a new one)
    noteEl.querySelector(".note-timestamp").addEventListener("click", () => {
      playNote(note);
    });

    // Delete button
    noteEl
      .querySelector(".note-delete")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        const button = e.currentTarget;
        if (button.disabled) return;
        setNoteDeleteFeedback(noteEl, button, {
          state: "pending",
          label: "…",
          message: t("notes.removing"),
          ariaLabel: t("notes.removingAria"),
        });

        const result = await deleteNote(note.id);
        if (!noteEl.isConnected) return;

        if (result?.success) {
          // The storage result is the deletion fact. Re-querying preserves the
          // existing empty-state and filter behavior after the card is removed.
          loadNotes(filteredVideoId);
          return;
        }

        setNoteDeleteFeedback(noteEl, button, {
          state: "error",
          label: t("notes.retryDelete"),
          message: result?.error
            ? t("notes.deleteFailedWithError", {
                error: localizeServiceError(result.error),
              })
            : t("notes.deleteFailed"),
          ariaLabel: t("notes.retryDeletingAria"),
        });
      });

    // Copy text button — copies just the note's text
    noteEl
      .querySelector(".note-copy-text")
      .addEventListener("click", async () => {
        const btn = noteEl.querySelector(".note-copy-text");
        if (btn.disabled) return;
        setLocalActionFeedback(btn, {
          state: "pending",
          label: t("notes.copying"),
          message: t("notes.copyingText"),
          ariaLabel: t("notes.copyingText"),
        });
        try {
          await navigator.clipboard.writeText(note.text);
          if (!btn.isConnected) return;
          setLocalActionFeedback(btn, {
            state: "success",
            label: `✓ ${t("notes.copied")}`,
            message: t("notes.textCopied"),
            ariaLabel: t("notes.textCopiedAria"),
          });
        } catch (err) {
          console.error("Copy failed:", err);
          if (!btn.isConnected) return;
          setLocalActionFeedback(btn, {
            state: "error",
            label: t("notes.retryCopy"),
            message: t("notes.copyTextFailed"),
            ariaLabel: t("notes.retryCopyText"),
          });
        }
      });

    // Copy timestamp button — copies the timestamped YouTube link
    noteEl
      .querySelector(".note-copy-link")
      .addEventListener("click", async () => {
        const btn = noteEl.querySelector(".note-copy-link");
        if (btn.disabled) return;
        setLocalActionFeedback(btn, {
          state: "pending",
          label: t("notes.copying"),
          message: t("notes.copyingTimestamp"),
          ariaLabel: t("notes.copyingTimestamp"),
        });
        try {
          await navigator.clipboard.writeText(note.timestampedUrl);
          if (!btn.isConnected) return;
          setLocalActionFeedback(btn, {
            state: "success",
            label: `✓ ${t("notes.copied")}`,
            message: t("notes.timestampCopied"),
            ariaLabel: t("notes.timestampCopiedAria"),
          });
        } catch (err) {
          console.error("Copy failed:", err);
          if (!btn.isConnected) return;
          setLocalActionFeedback(btn, {
            state: "error",
            label: t("notes.retryCopy"),
            message: t("notes.copyTimestampFailed"),
            manualCopyText: note.timestampedUrl,
            ariaLabel: t("notes.retryCopyTimestamp"),
          });
        }
      });

    // Play button (in this tab if it's the current video, else a new tab)
    noteEl.querySelector(".note-play").addEventListener("click", () => {
      playNote(note);
    });

    notesList.appendChild(noteEl);
  });
}

function setNoteDeleteFeedback(noteEl, button, { state, label, message, ariaLabel }) {
  noteEl.dataset.deleteState = state;
  button.dataset.feedbackState = state;
  button.disabled = state === "pending";
  button.setAttribute("aria-busy", String(state === "pending"));
  button.setAttribute("aria-label", ariaLabel);
  button.title = ariaLabel;
  button.textContent = label;

  const feedback = noteEl.querySelector(".note-feedback");
  if (!feedback) return;
  feedback.hidden = !message;
  feedback.dataset.feedbackState = state;
  feedback.textContent = message || "";
  feedback.setAttribute("role", state === "error" ? "alert" : "status");
}

/**
 * Deletes a note by ID.
 */
async function deleteNote(noteId) {
  try {
    return await chrome.runtime.sendMessage({
      action: "deleteNote",
      noteId: noteId,
    });
  } catch (error) {
    console.error("[YouTube Digest Panel] Delete note error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// AUTO-SCROLL — Follow video playback in transcript
// ============================================================
// While a video plays, the transcript automatically scrolls to show which
// 30-second chunk is currently being spoken. If the user manually scrolls
// (e.g., to read ahead), auto-scroll pauses and a "Follow playback" button
// appears so they can resume it. Highlight always stays active regardless.

function setFollowPlaybackState(state) {
  const button = document.getElementById("followPlaybackBtn");
  const status = document.getElementById("followPlaybackStatus");
  if (!button || !status) return;

  // This control belongs to the transcript reading context only. Keeping the
  // guard here makes asynchronous scroll events unable to reveal it after the
  // user has already switched to Overview or Notes.
  const visibleState =
    state === "paused" && isTranscriptTabActive() ? "paused" : "inactive";
  button.dataset.followState = visibleState;
  button.style.display = visibleState === "paused" ? "inline-flex" : "none";

  if (visibleState === "paused") {
    button.setAttribute("aria-label", t("follow.resume"));
    button.title = t("follow.resume");
    status.textContent = t("follow.paused");
    return;
  }

  if (state === "following") {
    button.setAttribute("aria-label", t("follow.follow"));
    button.title = t("follow.follow");
    status.textContent = t("follow.following");
    return;
  }

  button.setAttribute("aria-label", t("follow.follow"));
  button.title = t("follow.follow");
  status.textContent = "";
}

function isTranscriptTabActive() {
  return document.querySelector('.tab[data-tab="transcript"]')?.classList.contains("active");
}

function setPlaybackEntryState(entry, isCurrent) {
  const timestampButton = entry.querySelector(".transcript-time");
  if (isCurrent) {
    entry.dataset.playbackState = "current";
    entry.setAttribute("aria-current", "true");
    if (timestampButton) {
      timestampButton.setAttribute(
        "aria-label",
        t("transcript.currentlyPlaying", {
          timestamp: timestampButton.textContent,
        }),
      );
    }
    return;
  }

  delete entry.dataset.playbackState;
  entry.removeAttribute("aria-current");
  if (timestampButton) {
    timestampButton.setAttribute(
      "aria-label",
      t("transcript.playFrom", { timestamp: timestampButton.textContent }),
    );
  }
}

/**
 * Starts polling the video's current time and highlighting/scrolling
 * to the matching transcript entry.
 */
function startPlaybackTracking() {
  if (!currentTranscript || !currentTranscript.length) return;

  // Don't restart if already tracking (preserves user's auto-scroll state)
  if (autoScrollInterval) return;

  autoScrollEnabled = true;
  lastUserScrollIntentTime = 0;
  setFollowPlaybackState("following");

  // Poll video time every 500ms
  autoScrollInterval = setInterval(() => playbackTrackingTick(), 500);

  // Listen for manual scrolls on the content area
  const contentArea = document.getElementById("contentArea");
  if (!contentArea) return;
  contentArea.removeEventListener("scroll", onContentAreaScroll);
  contentArea.removeEventListener("wheel", recordUserScrollIntent);
  contentArea.removeEventListener("touchstart", recordUserScrollIntent);
  contentArea.removeEventListener("keydown", recordKeyboardScrollIntent);
  contentArea.removeEventListener("pointerdown", recordScrollbarScrollIntent);
  contentArea.addEventListener("scroll", onContentAreaScroll);
  contentArea.addEventListener("wheel", recordUserScrollIntent, {
    passive: true,
  });
  contentArea.addEventListener("touchstart", recordUserScrollIntent, {
    passive: true,
  });
  contentArea.addEventListener("keydown", recordKeyboardScrollIntent);
  contentArea.addEventListener("pointerdown", recordScrollbarScrollIntent);
}

/**
 * Stops playback tracking entirely. Called when leaving transcript tab,
 * starting a new digest, or leaving results state.
 */
function stopPlaybackTracking() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
  autoScrollEnabled = true; // Reset for next time
  lastUserScrollIntentTime = 0;
  setFollowPlaybackState("inactive");

  // Remove active highlights
  document
    .querySelectorAll(".transcript-entry.active-playback")
    .forEach((el) => {
      el.classList.remove("active-playback");
      setPlaybackEntryState(el, false);
    });
}

/**
 * One tick of the playback tracker. Gets current video time from the
 * YouTube tab and highlights + scrolls to the matching transcript entry.
 */
async function playbackTrackingTick() {
  try {
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: { action: "getCurrentTime" },
    });

    if (!result.success || !result.response) return;

    const currentTime = result.response.currentTime || 0;
    highlightActiveEntry(currentTime);
  } catch (error) {
    // Silently ignore — YouTube tab might be closed or navigated away
  }
}

/**
 * Scrolls the transcript to the entry currently being spoken (the one
 * carrying the active-playback highlight). Returns false if nothing is
 * highlighted yet. `behavior` may override the normal follow animation when
 * restoring playback, so recovery cannot be mistaken for a manual scroll.
 */
function scrollToActiveEntry(behavior = getPlaybackScrollBehavior()) {
  const activeEntry = document.querySelector(
    "#transcriptList .transcript-entry.active-playback",
  );
  if (!activeEntry) return false;

  activeEntry.scrollIntoView({ behavior, block: "center" });
  return true;
}

function getPlaybackScrollBehavior() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    ? "auto"
    : "smooth";
}

/**
 * Finds the transcript entry matching the current playback time,
 * highlights it, and scrolls to it (if auto-scroll is enabled).
 *
 * @param {number} currentSeconds - Current video playback time in seconds
 */
function highlightActiveEntry(currentSeconds) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  const entries = transcriptList.querySelectorAll(".transcript-entry");
  if (entries.length === 0) return;

  // Find the entry whose time range contains the current playback time
  let activeEntry = null;
  entries.forEach((entry, index) => {
    const entrySeconds = parseInt(entry.dataset.seconds);
    const nextEntry = entries[index + 1];
    const nextSeconds = nextEntry
      ? parseInt(nextEntry.dataset.seconds)
      : Infinity;

    if (currentSeconds >= entrySeconds && currentSeconds < nextSeconds) {
      activeEntry = entry;
    }
  });

  if (!activeEntry) return;

  // Skip if this entry is already highlighted (no DOM thrashing)
  if (activeEntry.classList.contains("active-playback")) return;

  // Remove old highlight, add new one. This says only where playback is; it
  // deliberately does not change the independent follow-playback state.
  entries.forEach((e) => {
    e.classList.remove("active-playback");
    setPlaybackEntryState(e, false);
  });
  activeEntry.classList.add("active-playback");
  setPlaybackEntryState(activeEntry, true);

  // Only scroll if auto-scroll is enabled
  if (autoScrollEnabled) {
    activeEntry.scrollIntoView({ behavior: getPlaybackScrollBehavior(), block: "center" });
  }
}

/**
 * Scroll event handler for the content area.
 * Detects intentional user scrolling and disables auto-scroll so the user
 * can read at their own pace without being yanked back. scrollIntoView()
 * emits ordinary scroll events too (and smooth scrolling can finish well
 * after it starts), so a scroll event by itself is not evidence of a manual
 * action.
 */
function onContentAreaScroll() {
  const hasRecentUserScrollIntent =
    Date.now() - lastUserScrollIntentTime <= USER_SCROLL_INTENT_WINDOW_MS;
  if (!hasRecentUserScrollIntent) return;

  // User scrolled manually — disable auto-scroll and show the button
  if (autoScrollEnabled && autoScrollInterval) {
    autoScrollEnabled = false;
    setFollowPlaybackState("paused");
  }
}

function recordUserScrollIntent() {
  lastUserScrollIntentTime = Date.now();
}

function recordKeyboardScrollIntent(event) {
  const scrollKeys = new Set([
    "ArrowDown",
    "ArrowUp",
    "PageDown",
    "PageUp",
    "Home",
    "End",
    " ",
  ]);
  if (scrollKeys.has(event.key)) recordUserScrollIntent();
}

function recordScrollbarScrollIntent(event) {
  const contentArea = event.currentTarget;
  const bounds = contentArea?.getBoundingClientRect?.();
  if (!bounds || typeof event.clientX !== "number") return;

  // Wheel/touch/keyboard cover ordinary reading. This covers the remaining
  // scrollbar-thumb path without treating clicks on transcript rows as scroll
  // intent.
  const scrollbarEdgeWidth = Math.max(
    16,
    (contentArea.offsetWidth || 0) - (contentArea.clientWidth || 0),
  );
  if (event.clientX >= bounds.right - scrollbarEdgeWidth) {
    recordUserScrollIntent();
  }
}

// ============================================================
// TRANSCRIPT MODE UI — Original / Chinese / aligned bilingual
// ============================================================

function getOriginalTranscriptLabel() {
  const language = String(currentTranscriptLanguage || "").trim();
  return /^[A-Za-z0-9-]{1,20}$/.test(language)
    ? t("transcript.originalWithLanguage", { language })
    : t("transcript.modeOriginal");
}

function getActiveTranscriptSegments() {
  return groupTranscriptEntries(currentTranscript || []);
}

function transcriptTranslationCacheKeyForVideo(videoId, segment) {
  return `${videoId}:zh:semantic:${segment.id}`;
}

function transcriptTranslationCacheKey(segment) {
  return transcriptTranslationCacheKeyForVideo(currentVideoId, segment);
}

function stopTranscriptTranslationSession() {
  activeTranslationQueue?.stop?.();
  activeTranslationQueue = null;
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
  transcriptScrollObserver = null;
  translationWorkCount = 0;
  setTranslatingSpinner(false);
}

function setTranscriptModeButtons(mode) {
  document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
    const active = button.dataset.transcriptMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function handleTranscriptModeChange(mode) {
  if (!["original", "zh", "bilingual"].includes(mode)) return;
  if (mode === currentTranscriptMode) return;

  currentTranscriptMode = mode;
  setTranscriptModeButtons(mode);

  if (mode === "original") {
    translationGeneration += 1;
    stopTranscriptTranslationSession();
    renderTranscript();
    return;
  }

  await translateTranscript();
}

function renderTranscriptSegmentContent(segment, mode, translated, error) {
  const original = renderSubtitleInlineMarkup(segment.text);
  let translationHtml = "";
  if (translated) {
    translationHtml = renderSubtitleInlineMarkup(translated);
  } else if (error) {
    const errorKey =
      error === "Translation unavailable."
        ? "transcript.unavailable"
        : "transcript.failed";
    translationHtml = `<span class="translation-error-message" data-i18n-error="${errorKey}">${escapeHtml(t(errorKey))}</span><button class="translation-retry-btn" type="button">${escapeHtml(t("transcript.retry"))}</button>`;
  } else {
    translationHtml = t("transcript.waiting");
  }

  const translationState = translated ? "complete" : error ? "error" : "pending";
  if (mode === "bilingual") {
    return `<span class="transcript-copy"><span class="transcript-original">${original}</span><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}" data-translation-state="${translationState}" role="status" aria-live="polite" aria-atomic="true">${translationHtml}</span></span>`;
  }

  return `<span class="transcript-copy"><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}" data-translation-state="${translationState}" role="status" aria-live="polite" aria-atomic="true">${translationHtml}</span></span>`;
}

function renderTranscriptModeRows(segments, mode) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return [];
  transcriptList.innerHTML = "";

  renderTranscriptSourceBadge(mode, transcriptList);

  const rows = [];
  segments.forEach((segment, index) => {
    const div = document.createElement("div");
    const cached = transcriptParagraphCache.get(
      transcriptTranslationCacheKey(segment),
    );
    div.className = `transcript-entry ${cached ? "translated" : "translating"}`;
    div.dataset.translationState = cached ? "complete" : "pending";
    div.dataset.seconds = segment.start;
    div.dataset.segmentId = segment.id;
    div.dataset.segmentIndex = index;

    const minutes = Math.floor(segment.start / 60);
    const seconds = Math.floor(segment.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;
    div.innerHTML = `
      <button class="transcript-time" type="button" aria-label="${escapeHtml(t("transcript.playFrom", { timestamp }))}">${timestamp}</button>
      ${renderTranscriptSegmentContent(segment, mode, cached, "")}
    `;
    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, segment.start),
    );
    transcriptList.appendChild(div);
    rows.push(div);
  });

  startPlaybackTracking();
  return rows;
}

/**
 * Rebuilds a provider response in source order. Unknown IDs are ignored and
 * missing IDs remain explicit errors, never positional guesses.
 */
function alignTranslatedSegmentBatch(sourceSegments, responseSegments) {
  const translatedById = new Map();
  if (Array.isArray(responseSegments)) {
    responseSegments.forEach((item) => {
      if (!item || typeof item.id !== "string" || typeof item.text !== "string")
        return;
      const text = item.text.trim();
      if (text && !translatedById.has(item.id)) {
        translatedById.set(item.id, text);
      }
    });
  }

  return sourceSegments.map((segment) => ({
    id: segment.id,
    text: translatedById.get(segment.id) || "",
    error: translatedById.has(segment.id) ? "" : "Translation unavailable.",
  }));
}

function updateTranslatedRow(segment, index, alignedItem, generation) {
  if (generation !== translationGeneration) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-id="${CSS.escape(segment.id)}"]`,
  );
  if (!row) return;

  if (alignedItem.text) {
    transcriptParagraphCache.set(
      transcriptTranslationCacheKey(segment),
      alignedItem.text,
    );
  }

  const copy = row.querySelector(".transcript-copy");
  if (copy) {
    copy.outerHTML = renderTranscriptSegmentContent(
      segment,
      currentTranscriptMode,
      alignedItem.text,
      alignedItem.error,
    );
  }
  row.classList.toggle("translated", !!alignedItem.text);
  row.classList.toggle("translating", false);
  row.classList.toggle("translation-failed", !alignedItem.text);
  row.dataset.translationState = alignedItem.text ? "complete" : "error";

  const retry = row.querySelector(".translation-retry-btn");
  if (retry) {
    ["mousedown", "mouseup"].forEach((eventName) => {
      retry.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      retryTranslationSegment(index, generation);
    });
  }
}

let activeTranslationQueue = null;

async function executeTranscriptTranslationBatch(videoId, sourceBatch, videoTitle) {
  try {
    const result = await sendTranslationMessage({
      action: "translateContent",
      content: {
        segments: sourceBatch.map(({ id, text }) => ({ id, text })),
      },
      contentType: "transcriptBatch",
      targetLanguage: "zh",
      videoTitle,
    });

    const responseSegments = result?.success
      ? result.translatedContent?.segments
      : [];
    const aligned = alignTranslatedSegmentBatch(sourceBatch, responseSegments);
    if (!result?.success) {
      aligned.forEach((item) => {
        item.error = result?.error || "Translation failed.";
      });
    }
    return aligned;
  } catch (error) {
    return sourceBatch.map((segment) => ({
      id: segment.id,
      text: "",
      error: error.message || "Translation failed.",
    }));
  }
}

/**
 * Reuses an already-running segment request when a mode/tab transition starts
 * a new translation session. This prevents a bilingual switch from sending
 * the same segment again while the Chinese request is still in flight.
 */
function getTranscriptTranslationPromises(videoId, sourceBatch, videoTitle) {
  const promisesByKey = new Map();
  const pending = [];

  sourceBatch.forEach((segment) => {
    const key = transcriptTranslationCacheKeyForVideo(videoId, segment);
    const existing = transcriptTranslationInFlight.get(key);
    if (existing) {
      promisesByKey.set(key, existing);
    } else {
      pending.push({ key, segment });
    }
  });

  if (pending.length) {
    const pendingSegments = pending.map(({ segment }) => segment);
    const operation = executeTranscriptTranslationBatch(
      videoId,
      pendingSegments,
      videoTitle,
    );

    pending.forEach(({ key }, index) => {
      let segmentPromise;
      segmentPromise = operation
        .then((aligned) =>
          aligned[index] || {
            id: pendingSegments[index].id,
            text: "",
            error: "Translation unavailable.",
          },
        )
        .finally(() => {
          if (transcriptTranslationInFlight.get(key) === segmentPromise) {
            transcriptTranslationInFlight.delete(key);
          }
        });
      transcriptTranslationInFlight.set(key, segmentPromise);
      promisesByKey.set(key, segmentPromise);
    });
  }

  return sourceBatch.map((segment) =>
    promisesByKey.get(transcriptTranslationCacheKeyForVideo(videoId, segment)),
  );
}

function rememberTranscriptTranslations(videoId, sourceBatch, aligned) {
  const entries = [];
  aligned.forEach((item, index) => {
    if (!item?.text) return;
    const key = transcriptTranslationCacheKeyForVideo(
      videoId,
      sourceBatch[index],
    );
    transcriptParagraphCache.set(key, item.text);
    entries.push({ key, text: item.text });
  });
  return entries;
}

/**
 * Persists by captured video ID so an old response can never be written into
 * the video that happens to be open when the provider finally replies.
 */
function persistTranscriptTranslations(videoId, entries) {
  if (!videoId || !entries.length) return Promise.resolve();

  const write = transcriptCacheWriteChain
    .catch(() => {})
    .then(async () => {
      const storageKey = `digest_${videoId}`;
      const stored = await chrome.storage.local.get(storageKey);
      const cached = stored[storageKey];
      if (!cached) return;

      const paragraphCache = { ...(cached.paragraphCache || {}) };
      entries.forEach(({ key, text }) => {
        paragraphCache[key] = text;
      });
      await chrome.storage.local.set({
        [storageKey]: {
          ...cached,
          paragraphCache,
          timestamp: Date.now(),
        },
      });
    })
    .catch((error) => {
      console.error("Translation cache save error:", error);
    });

  transcriptCacheWriteChain = write;
  return write;
}

async function requestTranscriptTranslationBatch(
  indices,
  segments,
  generation,
  videoId,
  mode,
  videoTitle,
) {
  const sourceBatch = indices.map((index) => segments[index]);
  setTranslatingSpinner(true);
  try {
    const aligned = await Promise.all(
      getTranscriptTranslationPromises(videoId, sourceBatch, videoTitle),
    );
    const cacheEntries = rememberTranscriptTranslations(
      videoId,
      sourceBatch,
      aligned,
    );

    const isStale =
      generation !== translationGeneration ||
      videoId !== currentVideoId ||
      mode !== currentTranscriptMode;
    if (!isStale) {
      aligned.forEach((item, batchIndex) => {
        updateTranslatedRow(
          sourceBatch[batchIndex],
          indices[batchIndex],
          item,
          generation,
        );
      });
    }
    await persistTranscriptTranslations(videoId, cacheEntries);
  } catch (error) {
    if (generation !== translationGeneration) return;
    sourceBatch.forEach((segment, batchIndex) => {
      updateTranslatedRow(
        segment,
        indices[batchIndex],
        { id: segment.id, text: "", error: error.message || "Translation failed." },
        generation,
      );
    });
  } finally {
    setTranslatingSpinner(false);
  }
}

function retryTranslationSegment(index, generation) {
  if (generation !== translationGeneration || !activeTranslationQueue) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-index="${index}"]`,
  );
  if (row) {
    row.classList.add("translating");
    row.classList.remove("translation-failed");
    row.dataset.translationState = "pending";
    const translation = row.querySelector(".transcript-translation");
    if (translation) {
      translation.className = "transcript-translation translation-pending";
      translation.textContent = t("transcript.retrying");
    }
  }
  activeTranslationQueue.enqueue(index, true);
}

/**
 * Renders immediately, translates the current visible window, then observes
 * rows as they enter the window. Batches are sequential so the provider is
 * never flooded and offscreen queued work is discarded before dispatch.
 */
async function translateTranscript() {
  const segments = getActiveTranscriptSegments();
  if (!segments.length || currentTranscriptMode === "original") return;

  translationGeneration += 1;
  const generation = translationGeneration;
  const videoId = currentVideoId;
  const mode = currentTranscriptMode;
  const videoTitle = currentVideoTitle;
  stopTranscriptTranslationSession();

  const rows = renderTranscriptModeRows(segments, mode);
  const queue = [];
  const queued = new Set();
  const eligible = new Set();
  let processing = false;
  let stopped = false;

  const removeQueued = (index) => {
    if (!queued.delete(index)) return;
    const position = queue.indexOf(index);
    if (position >= 0) queue.splice(position, 1);
  };

  const processNext = async () => {
    if (
      stopped ||
      processing ||
      queue.length === 0 ||
      generation !== translationGeneration
    )
      return;

    const indices = [];
    while (queue.length && indices.length < 3) {
      const index = queue.shift();
      queued.delete(index);
      if (!eligible.has(index)) continue;
      if (
        transcriptParagraphCache.has(
          transcriptTranslationCacheKeyForVideo(videoId, segments[index]),
        )
      ) {
        continue;
      }
      indices.push(index);
    }
    if (!indices.length) {
      if (queue.length && generation === translationGeneration) processNext();
      return;
    }

    processing = true;
    try {
      await requestTranscriptTranslationBatch(
        indices,
        segments,
        generation,
        videoId,
        mode,
        videoTitle,
      );
    } finally {
      processing = false;
      if (
        !stopped &&
        queue.length &&
        generation === translationGeneration
      ) {
        processNext();
      }
    }
  };

  const enqueue = (index, force = false) => {
    if (stopped || !Number.isInteger(index) || !segments[index]) return;
    if (!eligible.has(index)) return;
    const cached = transcriptParagraphCache.has(
      transcriptTranslationCacheKeyForVideo(videoId, segments[index]),
    );
    if ((!force && cached) || queued.has(index)) return;
    queue.push(index);
    queued.add(index);
    // Let all entries reported in the same viewport turn collect before the
    // worker starts, producing one small contextual multi-segment request.
    Promise.resolve().then(processNext);
  };

  const stop = () => {
    stopped = true;
    queue.length = 0;
    queued.clear();
    eligible.clear();
  };
  activeTranslationQueue = { enqueue, stop };

  transcriptScrollObserver = new IntersectionObserver(
    (observerEntries) => {
      observerEntries
        .sort(
          (a, b) =>
            Number(a.target.dataset.segmentIndex) -
            Number(b.target.dataset.segmentIndex),
        )
        .forEach((entry) => {
          const index = Number(entry.target.dataset.segmentIndex);
          if (entry.isIntersecting) {
            eligible.add(index);
            enqueue(index);
          } else {
            eligible.delete(index);
            removeQueued(index);
          }
        });
    },
    {
      root: document.getElementById("contentArea"),
      rootMargin: "120px 0px",
      threshold: 0,
    },
  );

  rows.forEach((row) => {
    if (!row.classList.contains("translated")) transcriptScrollObserver.observe(row);
  });
}

function setTranslatingSpinner(show) {
  if (show) translationWorkCount += 1;
  else translationWorkCount = Math.max(0, translationWorkCount - 1);
  const isTranslating = translationWorkCount > 0;
  const spinner = document.getElementById("langSpinner");
  if (spinner) spinner.classList.toggle("visible", isTranslating);
}

// Pure helpers are exposed for the repository's Node tests. The extension does
// not read this object at runtime.
globalThis.__YTD_TRANSCRIPT_TESTING__ = {
  sendTranslationMessage,
  groupTranscriptEntries,
  splitOversizedThought,
  alignTranslatedSegmentBatch,
  transcriptTranslationCacheKeyForVideo,
  getTranscriptTranslationPromises,
  persistTranscriptTranslations,
  renderSubtitleInlineMarkup,
  renderTranscriptSegmentContent,
};
