/**
 * CONTENT SCRIPT
 *
 * This script runs ON the YouTube page itself. It can see and modify
 * the YouTube page DOM (the HTML elements).
 *
 * It handles:
 * 1. Extracting video info (title, channel name) from the page
 * 2. Injecting "key moment" markers onto YouTube's progress bar
 * 3. Adding a "Digest" button to YouTube's action bar (next to Share/Save)
 *
 * Think of it like a robot sitting inside the YouTube tab,
 * reading the page and making small visual changes.
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};
const I18N = YTD_I18N;
let currentUiLanguage = I18N.DEFAULT_LANGUAGE;
const t = (key, params) => I18N.translate(currentUiLanguage, key, params);

// ============================================================
// GLOBAL STATE
// ============================================================

let ytdNoteButton = null;
let ytdNoteButtonTimer = null;
let ytdNoteButtonFeedbackTimer = null;
let ytdNoteToastDismissTimer = null;
let ytdNoteKeyboardListenerAdded = false;
let ytdNoteButtonRetryTimer = null;
let ytdDigestButton = null;
let digestButtonObserver = null;
let digestButtonReconcileTimer = null;
let digestButtonResizeListenerAdded = false;
// A navigation invalidates every pending host-page response for the old video.
// This only guards visual writes; it does not change the existing save request.
let hostPageLifecycleEpoch = 0;
let visibleNoteToast = null;

// The host page cannot consume an extension stylesheet without changing the
// manifest. Keep its Token scope attached only to our existing injected UI.
function ensureHostDesignSystemStyles() {
  if (!document.head || document.getElementById("ytd-design-system-tokens")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "ytd-design-system-tokens";
  style.textContent = `
    :is(#ytd-digest-button, #ytd-note-button, #ytd-note-toast) {
      /* ref.* */
      --ref-color-brand-red: #ff0000;
      --ref-color-brand-red-strong: #cc0000;
      --ref-color-brand-red-hover: #a30000;
      --ref-color-surface-canvas: #ffffff;
      --ref-color-surface-subtle: #f9f9f9;
      --ref-color-surface-control: #f2f2f2;
      --ref-color-surface-hover: #e5e5e5;
      --ref-color-text-primary: #0f0f0f;
      --ref-color-text-secondary: #606060;
      --ref-color-text-muted: #909090;
      --ref-color-state-success-foreground: #1b6e4f;
      --ref-color-state-success-surface: #eaf6f0;
      --ref-color-state-success-border: #a9d8c1;
      --ref-color-state-error-foreground: #b3261e;
      --ref-color-state-error-surface: #fdecea;
      --ref-color-state-error-border: #e7a7a1;
      --ref-color-state-warning-foreground: #8a5a00;
      --ref-color-state-warning-surface: #fff4d6;
      --ref-color-state-warning-border: #e8c66a;
      --ref-color-state-info-foreground: #0b5cad;
      --ref-color-state-info-surface: #eaf2fb;
      --ref-color-state-info-border: #a9c7ee;
      --ref-color-state-disabled-foreground: #606060;
      --ref-color-state-disabled-surface: #f2f2f2;
      --ref-color-state-disabled-border: #d0d0d0;
      --ref-color-state-disabled-indicator: #909090;
      --ref-color-focus-ring: #005fcc;
      --ref-color-playback-surface: rgba(255, 0, 0, 0.08);
      --ref-space-2: 8px;
      --ref-space-3: 10px;
      --ref-space-4: 12px;
      --ref-space-5: 14px;
      --ref-space-6: 16px;
      --ref-space-7: 24px;
      --ref-radius-xs: 6px;
      --ref-radius-control: 8px;
      --ref-radius-card: 12px;
      --ref-radius-overlay: 16px;
      --ref-radius-pill: 9999px;
      --ref-elevation-raised: 0 2px 8px rgba(0, 0, 0, 0.12);
      --ref-elevation-overlay: 0 12px 32px rgba(0, 0, 0, 0.2);
      --ref-font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
      --ref-font-reading: var(--ref-font-ui);
      --ref-font-mono: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "PingFang SC", monospace;
      --ref-icon-size-14: 14px;
      --ref-icon-hit-area: 36px;

      /* sys.* */
      --sys-brand-mark: var(--ref-color-brand-red);
      --sys-brand-strong: var(--ref-color-brand-red-strong);
      --sys-action-primary-bg: var(--ref-color-brand-red-strong);
      --sys-action-primary-fg: var(--ref-color-surface-canvas);
      --sys-action-primary-hover: var(--ref-color-brand-red-hover);
      --sys-surface-canvas: var(--ref-color-surface-canvas);
      --sys-surface-subtle: var(--ref-color-surface-subtle);
      --sys-surface-control: var(--ref-color-surface-control);
      --sys-surface-hover: var(--ref-color-surface-hover);
      --sys-text-primary: var(--ref-color-text-primary);
      --sys-text-secondary: var(--ref-color-text-secondary);
      --sys-text-muted: var(--ref-color-text-muted);
      --sys-border-default: var(--ref-color-surface-hover);
      --sys-border-strong: var(--ref-color-state-disabled-border);
      --sys-border-interactive: var(--ref-color-brand-red-strong);
      --sys-state-success-foreground: var(--ref-color-state-success-foreground);
      --sys-state-success-surface: var(--ref-color-state-success-surface);
      --sys-state-success-border: var(--ref-color-state-success-border);
      --sys-state-success-indicator: var(--ref-color-state-success-foreground);
      --sys-state-error-foreground: var(--ref-color-state-error-foreground);
      --sys-state-error-surface: var(--ref-color-state-error-surface);
      --sys-state-error-border: var(--ref-color-state-error-border);
      --sys-state-error-indicator: var(--ref-color-state-error-foreground);
      --sys-state-warning-foreground: var(--ref-color-state-warning-foreground);
      --sys-state-warning-surface: var(--ref-color-state-warning-surface);
      --sys-state-warning-border: var(--ref-color-state-warning-border);
      --sys-state-warning-indicator: var(--ref-color-state-warning-foreground);
      --sys-state-info-foreground: var(--ref-color-state-info-foreground);
      --sys-state-info-surface: var(--ref-color-state-info-surface);
      --sys-state-info-border: var(--ref-color-state-info-border);
      --sys-state-info-indicator: var(--ref-color-state-info-foreground);
      --sys-state-disabled-foreground: var(--ref-color-state-disabled-foreground);
      --sys-state-disabled-surface: var(--ref-color-state-disabled-surface);
      --sys-state-disabled-border: var(--ref-color-state-disabled-border);
      --sys-state-disabled-indicator: var(--ref-color-state-disabled-indicator);
      --sys-state-focus-ring-color: var(--ref-color-focus-ring);
      --sys-state-focus-ring-width: 2px;
      --sys-state-focus-ring-offset: 2px;
      --sys-interaction-hover: var(--ref-color-surface-subtle);
      --sys-interaction-pressed: var(--ref-color-surface-hover);
      --sys-interaction-selected: var(--ref-color-surface-control);
      --sys-interaction-playback-surface: var(--ref-color-playback-surface);
      --sys-interaction-playback-indicator: var(--ref-color-brand-red-strong);
      --sys-interaction-loading-indicator: var(--ref-color-brand-red-strong);
      --sys-layout-inline-gap: var(--ref-space-2);
      --sys-layout-control-gap: var(--ref-space-4);
      --sys-layout-panel-inset: var(--ref-space-6);
      --sys-elevation-raised: var(--ref-elevation-raised);
      --sys-elevation-overlay: var(--ref-elevation-overlay);
      --sys-shape-badge: var(--ref-radius-xs);
      --sys-shape-control: var(--ref-radius-control);
      --sys-shape-card: var(--ref-radius-card);
      --sys-shape-overlay: var(--ref-radius-overlay);
      --sys-shape-pill: var(--ref-radius-pill);
      --sys-font-ui: var(--ref-font-ui);
      --sys-font-reading: var(--ref-font-reading);
      --sys-font-mono: var(--ref-font-mono);
      --sys-type-body: 400 14px/1.6 var(--sys-font-reading);
      --sys-type-label: 500 13px/1.4 var(--sys-font-ui);
      --sys-type-meta: 400 12px/1.45 var(--sys-font-ui);
      --sys-icon-size: var(--ref-icon-size-14);
      --sys-icon-hit-area: var(--ref-icon-hit-area);

      /* comp.* */
      --comp-host-action-digest-bg: var(--sys-action-primary-bg);
      --comp-host-action-note-bg: var(--sys-action-primary-bg);
      --comp-host-action-fg: var(--sys-action-primary-fg);
      --comp-host-action-radius: var(--sys-shape-pill);
      --comp-host-action-hit-area: var(--sys-icon-hit-area);
      --comp-toast-bg: var(--sys-surface-canvas);
      --comp-toast-border: var(--sys-border-default);
      --comp-toast-radius: var(--sys-shape-overlay);
    }

    #ytd-digest-button:focus-visible,
    #ytd-note-button:focus-visible,
    #ytd-note-toast a:focus-visible {
      outline: var(--sys-state-focus-ring-width) solid var(--sys-state-focus-ring-color) !important;
      outline-offset: var(--sys-state-focus-ring-offset) !important;
    }

    #ytd-digest-button:active {
      background: var(--sys-action-primary-hover) !important;
      box-shadow: none !important;
    }

    #ytd-note-button[data-note-state="saved"] {
      background: var(--sys-state-success-surface) !important;
      border: 1px solid var(--sys-state-success-border) !important;
      color: var(--sys-state-success-foreground) !important;
      box-shadow: var(--sys-elevation-raised) !important;
    }

    #ytd-note-button[data-note-state="error"] {
      background: var(--sys-state-error-surface) !important;
      border: 1px solid var(--sys-state-error-border) !important;
      color: var(--sys-state-error-foreground) !important;
      box-shadow: var(--sys-elevation-raised) !important;
    }

    #ytd-note-button[data-note-state="saving"] {
      cursor: progress !important;
    }

    @media (prefers-reduced-motion: reduce) {
      #ytd-digest-button,
      #ytd-note-button,
      #ytd-note-toast {
        animation: none !important;
        scroll-behavior: auto !important;
        transition: none !important;
        transform: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * When the page loads, inject our Digest button and Note button.
 * We wait a bit for YouTube's UI to fully render.
 */
function init() {
  // Register the global "n" keyboard shortcut once
  if (!ytdNoteKeyboardListenerAdded) {
    document.addEventListener("keydown", handleNoteKeyboardShortcut);
    ytdNoteKeyboardListenerAdded = true;
  }

  // Try to inject the buttons immediately
  injectDigestButton();
  tryInjectNoteButton();

  // Also set up an observer to handle YouTube's dynamic content loading
  // (YouTube is an SPA, so elements appear/disappear as you navigate)
  setupButtonObserver();
  setupDigestButtonResizeListener();
}

async function initializeUiLanguage() {
  try {
    const result = await chrome.runtime.sendMessage({ action: "getUiLanguage" });
    if (result?.success) {
      currentUiLanguage = I18N.normalizeLanguage(result.language);
    }
  } catch (error) {
    currentUiLanguage = I18N.DEFAULT_LANGUAGE;
  }
  refreshHostUiCopy();
}

function refreshHostUiCopy() {
  updateDigestButtonCopy(ytdDigestButton);
  if (ytdNoteButton?.isConnected) {
    setNoteButtonState(ytdNoteButton, ytdNoteButton.dataset.noteState || "idle");
  }
  if (visibleNoteToast?.isConnected) showNoteSavedToast(visibleNoteToast.note);
}

/**
 * Attempts to inject the note button. If the player container isn't ready yet,
 * retry a few times with a short delay. YouTube renders the player asynchronously
 * after navigation, so a single immediate attempt can miss it.
 */
function tryInjectNoteButton() {
  if (!window.location.pathname.includes("/watch")) return;

  // Clear any existing retry so we don't stack timers
  if (ytdNoteButtonRetryTimer) {
    clearInterval(ytdNoteButtonRetryTimer);
    ytdNoteButtonRetryTimer = null;
  }

  let attempts = 0;
  const maxAttempts = 30; // ~3 seconds of retrying

  function attempt() {
    attempts++;
    const playerContainer = document.querySelector(
      "#movie_player.html5-video-player, #movie_player, .html5-video-player",
    );

    if (playerContainer) {
      injectNoteButton();
      if (ytdNoteButtonRetryTimer) {
        clearInterval(ytdNoteButtonRetryTimer);
        ytdNoteButtonRetryTimer = null;
      }
      return;
    }

    if (attempts >= maxAttempts) {
      debugLog(
        "[YouTube Digest Content] Player container not found after retries, giving up",
      );
      if (ytdNoteButtonRetryTimer) {
        clearInterval(ytdNoteButtonRetryTimer);
        ytdNoteButtonRetryTimer = null;
      }
    }
  }

  attempt();
  if (!ytdNoteButton || !ytdNoteButton.isConnected) {
    ytdNoteButtonRetryTimer = setInterval(attempt, 100);
  }
}

// Run init when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initializeUiLanguage().finally(init);
  });
} else {
  initializeUiLanguage().finally(init);
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

/**
 * Listen for messages from the side panel or background script.
 * When they ask for video info, we read it from the page.
 * When they send key moments, we highlight them on the progress bar.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog("[YouTube Digest Content] Received message:", message.action, message);

  if (message.action === "getVideoInfo") {
    // Read video title and channel name from the page
    const info = extractVideoInfo();
    debugLog("[YouTube Digest Content] Returning video info:", info);
    sendResponse(info);
    return false; // Synchronous response
  }

  if (message.action === "highlightMoments") {
    // Key moment markers disabled — chapters are shown in the side panel only.
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "getCurrentTime") {
    // Return the current video playback time (used by auto-scroll)
    const video = document.querySelector("video.html5-main-video");
    sendResponse({
      currentTime: video ? Math.floor(video.currentTime) : 0,
      paused: video ? video.paused : true,
    });
    return false;
  }

  if (message.action === "seekTo") {
    // Jump the video to a specific timestamp
    debugLog("[YouTube Digest Content] Seeking to:", message.seconds);
    seekToTimestamp(message.seconds);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "showNoteSavedFeedback") {
    // Show brief feedback that note was saved
    showNoteSavedToast(message.note);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "uiLanguageChanged") {
    currentUiLanguage = I18N.normalizeLanguage(message.language);
    refreshHostUiCopy();
    sendResponse({ success: true });
    return false;
  }

  // Unknown action - still send a response to prevent hanging
  debugLog("[YouTube Digest Content] Unknown action:", message.action);
  sendResponse({ success: false, error: "Unknown action" });
  return false;
});

// ============================================================
// DIGEST BUTTON INJECTION
// ============================================================

/**
 * Injects a "Digest" button into YouTube's action bar.
 * The button appears next to Share, Save, etc. below the video.
 *
 * When clicked, it opens the YouTube Digest side panel.
 */
function isVisibleDigestHost(element) {
  if (!element || !element.isConnected) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * YouTube keeps hidden copies of its responsive action toolbar in the DOM.
 * querySelector() can return one of those 0x0 copies before the toolbar the
 * viewer can actually see, so inspect every candidate and resolve the native
 * button group inside the visible action row for the current video.
 */
function findDigestButtonHost() {
  const primaryActionRows = Array.from(
    document.querySelectorAll("ytd-watch-metadata #actions-inner"),
  );

  for (const actionRow of primaryActionRows) {
    if (!isVisibleDigestHost(actionRow)) continue;

    const visibleButtonGroup = Array.from(
      actionRow.querySelectorAll("#top-level-buttons-computed"),
    ).find(isVisibleDigestHost);
    if (visibleButtonGroup) return visibleButtonGroup;
  }

  const fallbackCandidates = Array.from(
    document.querySelectorAll(
      "ytd-watch-metadata #actions #top-level-buttons-computed, " +
        "ytd-watch-metadata #top-level-buttons-computed, " +
        "#primary #actions #top-level-buttons-computed",
    ),
  );

  return (
    fallbackCandidates.find(
      (candidate) =>
        isVisibleDigestHost(candidate) &&
        (candidate.closest("ytd-watch-metadata") ||
          candidate.closest("#primary")),
    ) || null
  );
}

function createDigestButton() {
  ensureHostDesignSystemStyles();
  const digestButton = document.createElement("button");
  digestButton.id = "ytd-digest-button";
  digestButton.type = "button";
  digestButton.innerHTML = `
    <span class="ytd-digest-icon" style="font-size: var(--sys-icon-size);">▶</span>
    <span class="ytd-digest-label"></span>
  `;
  updateDigestButtonCopy(digestButton);

  // The host keeps its native placement; only its visual contract is tokenized.
  digestButton.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: var(--sys-layout-inline-gap);
    padding: 0 var(--sys-layout-panel-inset);
    height: var(--comp-host-action-hit-area);
    border: none;
    border-radius: var(--comp-host-action-radius);
    background: var(--comp-host-action-digest-bg);
    color: var(--comp-host-action-fg);
    font-family: var(--sys-font-ui);
    font-size: var(--sys-icon-size);
    font-weight: 600;
    cursor: pointer;
    margin-right: var(--sys-layout-inline-gap);
    transition: background 0.2s, box-shadow 0.2s;
    box-shadow: var(--sys-elevation-raised);
    flex: 0 0 auto;
    align-self: center;
    width: max-content;
    min-width: max-content;
    max-width: max-content;
    white-space: nowrap;
  `;

  // Hover effects
  digestButton.addEventListener("mouseenter", () => {
    digestButton.style.background = "var(--sys-action-primary-hover)";
  });

  digestButton.addEventListener("mouseleave", () => {
    digestButton.style.background = "var(--comp-host-action-digest-bg)";
  });

  // Click handler — open the side panel
  digestButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    debugLog("[YouTube Digest] Digest button clicked");

    // Send message to background script to open side panel
    try {
      const result = await chrome.runtime.sendMessage({
        action: "openSidePanel",
      });
      debugLog("[YouTube Digest] openSidePanel response:", result);
    } catch (err) {
      console.error("[YouTube Digest] Failed to open side panel:", err);
    }
  });

  ytdDigestButton = digestButton;
  return digestButton;
}

function updateDigestButtonCopy(button) {
  // createDigestButton localizes before the element is inserted into YouTube's
  // action row. Do not use connection state as a guard here or the first
  // render falls back to an empty/stale label until a later language change.
  if (!button) return;
  button.setAttribute("aria-label", t("host.open"));
  const label = button.querySelector?.(".ytd-digest-label");
  if (label) label.textContent = t("host.digest");
}

/**
 * Reconciles the Digest button with YouTube's currently visible action row.
 * This is intentionally idempotent because YouTube rebuilds its watch page
 * during navigation and at responsive breakpoints.
 */
function injectDigestButton() {
  const existingButtons = Array.from(
    document.querySelectorAll("#ytd-digest-button"),
  );

  if (!window.location.pathname.includes("/watch")) {
    existingButtons.forEach((button) => button.remove());
    ytdDigestButton = null;
    return false;
  }

  const actionsContainer = findDigestButtonHost();
  if (!actionsContainer) {
    debugLog("[YouTube Digest Content] Visible actions container not found yet");
    return false;
  }

  let digestButton = existingButtons.find(
    (button) => button === ytdDigestButton,
  );

  if (!digestButton) {
    existingButtons.forEach((button) => button.remove());
    existingButtons.length = 0;
    digestButton = createDigestButton();
  }

  existingButtons.forEach((button) => {
    if (button !== digestButton) button.remove();
  });

  if (digestButton.parentElement !== actionsContainer) {
    // YouTube turns #actions-inner into a vertical flex column at narrow
    // breakpoints. A direct child there stretches into a full-width second
    // row, so keep Digest inside the native horizontal button group and
    // prepend it to preserve visibility when space is limited.
    actionsContainer.insertBefore(digestButton, actionsContainer.firstChild);
  }

  debugLog("[YouTube Digest Content] Digest button reconciled");
  return true;
}

function scheduleDigestButtonReconciliation(delay = 80) {
  if (digestButtonReconcileTimer) {
    clearTimeout(digestButtonReconcileTimer);
  }

  digestButtonReconcileTimer = setTimeout(() => {
    digestButtonReconcileTimer = null;
    injectDigestButton();
  }, delay);
}

function setupDigestButtonResizeListener() {
  if (digestButtonResizeListenerAdded) return;

  window.addEventListener("resize", () => {
    scheduleDigestButtonReconciliation(120);
  });
  digestButtonResizeListenerAdded = true;
}

/**
 * Sets up a MutationObserver to watch for YouTube's dynamic content changes.
 * When the action buttons container appears (after navigation), we inject our button.
 */
function setupButtonObserver() {
  if (digestButtonObserver) return;

  digestButtonObserver = new MutationObserver(() => {
    // Check if we need to inject the buttons
    if (window.location.pathname.includes("/watch")) {
      scheduleDigestButtonReconciliation();
      if (!ytdNoteButton || !ytdNoteButton.isConnected) {
        tryInjectNoteButton();
      }
    }
  });

  // Watch the entire body for changes (YouTube rebuilds large chunks of the DOM)
  digestButtonObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// ============================================================
// NOTE BUTTON (Overlay on Video Player)
// ============================================================

/**
 * Injects a "Note" button overlay on top of the YouTube video player.
 * The button appears when the mouse enters or moves over the player and hides
 * after the cursor stays still for more than 2 seconds or leaves the player.
 */
function injectNoteButton() {
  // Don't inject if we're not on a video page
  if (!window.location.pathname.includes("/watch")) return;
  ensureHostDesignSystemStyles();

  // Don't inject if button already exists and is properly tracked.
  // If a stale button exists (e.g., from a previous content-script instance),
  // remove it and re-inject so event listeners are attached to the live one.
  const existingButton = document.getElementById("ytd-note-button");
  if (existingButton) {
    if (ytdNoteButton === existingButton && existingButton.isConnected) {
      return; // already injected and connected
    }
    existingButton.remove();
  }

  // Find the video player container. YouTube rebuilds this dynamically, so
  // we try the most common selectors.
  const playerContainer = document.querySelector(
    "#movie_player.html5-video-player, " +
      "#movie_player, " +
      ".html5-video-player",
  );

  if (!playerContainer) {
    debugLog(
      "[YouTube Digest Content] Player container not found yet, will retry",
    );
    return;
  }

  // Ensure the player container has relative positioning for absolute children
  if (
    window.getComputedStyle(playerContainer).position === "static" ||
    !playerContainer.style.position
  ) {
    playerContainer.style.position = "relative";
  }

  debugLog("[YouTube Digest Content] Injecting note button");

  // Create the Note control in the existing player-layer location.
  const noteButton = document.createElement("button");
  noteButton.id = "ytd-note-button";
  noteButton.type = "button";
  noteButton.setAttribute("aria-live", "polite");
  noteButton.setAttribute("aria-atomic", "true");
  noteButton.setAttribute("aria-hidden", "true");
  noteButton.tabIndex = -1;
  setNoteButtonState(noteButton, "idle");

  // Start hidden; visibility is controlled by the existing mouse lifecycle.
  noteButton.style.cssText = `
    position: absolute;
    top: var(--sys-layout-panel-inset);
    right: var(--sys-layout-panel-inset);
    z-index: 9999;
    display: flex;
    align-items: center;
    min-height: var(--comp-host-action-hit-area);
    padding: 9px var(--sys-layout-panel-inset);
    background: var(--comp-host-action-note-bg);
    color: var(--comp-host-action-fg);
    border: none;
    border-radius: var(--comp-host-action-radius);
    font: var(--sys-type-label);
    letter-spacing: 0.2px;
    cursor: pointer;
    transition: opacity 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
    opacity: 0;
    pointer-events: none;
    box-shadow: var(--sys-elevation-raised);
  `;

  ytdNoteButton = noteButton;

  // Show button when mouse enters or moves over the player.
  // Hide after 2 seconds of idle or when the mouse leaves.
  playerContainer.addEventListener("mouseenter", () => {
    showNoteButton();
    resetNoteButtonTimer();
  });

  playerContainer.addEventListener("mousemove", () => {
    showNoteButton();
    resetNoteButtonTimer();
  });

  playerContainer.addEventListener("mouseleave", () => {
    clearTimeout(ytdNoteButtonTimer);
    ytdNoteButtonTimer = null;
    hideNoteButton();
  });

  // Hover effect — lift slightly
  noteButton.addEventListener("mouseenter", () => {
    if (noteButton.dataset.noteState !== "idle") return;
    noteButton.style.background = "var(--sys-action-primary-hover)";
    noteButton.style.boxShadow = "var(--sys-elevation-overlay)";
  });

  noteButton.addEventListener("mouseleave", () => {
    if (noteButton.dataset.noteState !== "idle") return;
    noteButton.style.background = "var(--comp-host-action-note-bg)";
    noteButton.style.boxShadow = "var(--sys-elevation-raised)";
  });

  // Click handler — save the current moment as a note
  noteButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await saveCurrentNote();
  });

  playerContainer.appendChild(noteButton);

  debugLog("[YouTube Digest Content] Note button injected");
}

function showNoteButton() {
  if (!ytdNoteButton) return;
  ytdNoteButton.style.opacity = "1";
  ytdNoteButton.setAttribute("aria-hidden", "false");
  updateNoteButtonInteractivity(ytdNoteButton);
}

function hideNoteButton() {
  if (!ytdNoteButton) return;
  ytdNoteButton.style.opacity = "0";
  ytdNoteButton.setAttribute("aria-hidden", "true");
  updateNoteButtonInteractivity(ytdNoteButton);
}

function getNoteButtonMarkup(state) {
  if (state === "saving") {
    return `<span>${escapeHtmlForContent(t("host.saving"))}</span>`;
  }

  if (state === "saved") {
    return `<span aria-hidden="true">✓</span><span>${escapeHtmlForContent(t("host.saved"))}</span>`;
  }

  if (state === "error") {
    return `<span aria-hidden="true">!</span><span>${escapeHtmlForContent(t("host.noteSaveFailed"))}</span>`;
  }

  return `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right: var(--sys-layout-inline-gap);" aria-hidden="true">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
    </svg>
    <span>${escapeHtmlForContent(t("host.note"))}</span>
  `;
}

function updateNoteButtonInteractivity(noteButton) {
  const isVisible = noteButton.getAttribute("aria-hidden") !== "true";
  const isSaving = noteButton.dataset.noteState === "saving";
  noteButton.style.pointerEvents = isVisible && !isSaving ? "auto" : "none";
  noteButton.tabIndex = isVisible && !isSaving ? 0 : -1;
}

function setNoteButtonState(noteButton, state) {
  const labels = {
    idle: t("host.saveNote"),
    saving: t("host.saving"),
    saved: t("host.noteSaved"),
    error: t("host.noteSaveFailed"),
  };

  noteButton.dataset.noteState = state;
  noteButton.innerHTML = getNoteButtonMarkup(state);
  noteButton.disabled = state === "saving";
  noteButton.setAttribute("aria-busy", String(state === "saving"));
  noteButton.setAttribute("aria-label", labels[state]);

  if (state === "saving") {
    noteButton.style.background = "var(--sys-interaction-loading-indicator)";
  } else if (state === "saved") {
    noteButton.style.background = "var(--sys-state-success-foreground)";
  } else if (state === "error") {
    noteButton.style.background = "var(--sys-state-error-foreground)";
  } else {
    noteButton.style.background = "var(--comp-host-action-note-bg)";
  }

  updateNoteButtonInteractivity(noteButton);
}

function resetNoteButtonTimer() {
  clearTimeout(ytdNoteButtonTimer);
  ytdNoteButtonTimer = setTimeout(() => {
    hideNoteButton();
  }, 2000);
}

/**
 * Handles the "n" keyboard shortcut for saving a note.
 * Only triggers on YouTube watch pages and when the user is not typing
 * in an input field.
 */
function handleNoteKeyboardShortcut(e) {
  if (!window.location.pathname.includes("/watch")) return;
  if (e.key !== "n" && e.key !== "N") return;

  // Ignore if the user is typing in an input/textarea/contenteditable
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable)
  ) {
    return;
  }

  // Prevent YouTube's own "n" shortcut (e.g. next video in playlist)
  e.preventDefault();
  e.stopPropagation();

  // Show brief visual feedback on the button, then save
  showNoteButton();
  resetNoteButtonTimer();
  saveCurrentNote();
}

/**
 * Captures the current timestamp and saves it as a note.
 */
async function saveCurrentNote() {
  debugLog("[YouTube Digest] Saving note");

  const video = document.querySelector("video.html5-main-video");
  if (!video) {
    console.error("[YouTube Digest] No video element found");
    return;
  }

  // Go back 3 seconds to capture what was just said (user reacts after hearing it)
  const currentTime = Math.max(0, Math.floor(video.currentTime) - 3);
  const videoInfo = extractVideoInfo();
  const videoId = new URLSearchParams(window.location.search).get("v");

  const noteButton = ytdNoteButton;
  const saveLifecycleEpoch = hostPageLifecycleEpoch;

  // The keyboard shortcut can be pressed while a previous save is still
  // pending. Keep one request and one feedback lifecycle per Note control.
  if (noteButton?.dataset.noteState === "saving") {
    return;
  }

  if (noteButton) {
    setNoteButtonState(noteButton, "saving");
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveNote",
      videoId: videoId,
      timestamp: currentTime,
      videoTitle: videoInfo.title,
      channelName: videoInfo.channelName,
    });

    // YouTube can replace the video while the existing save request is pending.
    // Its result still belongs to storage, but it must not recreate old-video
    // Saved/Error/Toast feedback in the newly adapted page.
    if (saveLifecycleEpoch !== hostPageLifecycleEpoch) {
      return;
    }

    if (result.success) {
      if (noteButton) {
        setNoteButtonState(noteButton, "saved");
        scheduleNoteButtonStateReset(noteButton, saveLifecycleEpoch);
      }
      showNoteSavedToast(result.note);
    } else {
      if (noteButton) {
        setNoteButtonState(noteButton, "error");
        scheduleNoteButtonStateReset(noteButton, saveLifecycleEpoch);
      }
      console.error("[YouTube Digest] Save note error:", result.error);
    }
  } catch (err) {
    if (saveLifecycleEpoch !== hostPageLifecycleEpoch) {
      return;
    }

    if (noteButton) {
      setNoteButtonState(noteButton, "error");
      scheduleNoteButtonStateReset(noteButton, saveLifecycleEpoch);
    }
    console.error("[YouTube Digest] Save note exception:", err);
  }
}

// Saved and error are brief acknowledgements, not persistent button modes.
// Guard the delayed reset so a result from an old YouTube SPA page cannot
// mutate a newly injected Note control.
function scheduleNoteButtonStateReset(noteButton, saveLifecycleEpoch) {
  clearTimeout(ytdNoteButtonFeedbackTimer);
  ytdNoteButtonFeedbackTimer = setTimeout(() => {
    ytdNoteButtonFeedbackTimer = null;

    if (
      saveLifecycleEpoch !== hostPageLifecycleEpoch ||
      noteButton !== ytdNoteButton ||
      !noteButton.isConnected
    ) {
      return;
    }

    setNoteButtonState(noteButton, "idle");
  }, 2000);
}

/**
 * Shows a toast notification when a note is saved.
 */
function showNoteSavedToast(note) {
  ensureHostDesignSystemStyles();
  // Remove existing toast
  const existingToast = document.getElementById("ytd-note-toast");
  if (existingToast) existingToast.remove();
  clearTimeout(ytdNoteToastDismissTimer);
  ytdNoteToastDismissTimer = null;

  const toast = document.createElement("div");
  toast.note = note;
  toast.id = "ytd-note-toast";
  toast.setAttribute("aria-live", "polite");
  toast.setAttribute("aria-atomic", "true");
  toast.innerHTML = `
    <div style="font: var(--sys-type-label); margin-bottom: var(--sys-layout-inline-gap); color: var(--sys-state-success-foreground);">📝 ${escapeHtmlForContent(t("host.noteSaved"))}</div>
    <div style="font: var(--sys-type-meta); color: var(--sys-text-secondary); margin-bottom: var(--sys-layout-inline-gap);">${escapeHtmlForContent(note.timestamp)} — ${escapeHtmlForContent(note.videoTitle)}</div>
    <div style="font: var(--sys-type-body); color: var(--sys-text-primary);">"${escapeHtmlForContent(note.text)}"</div>
    <div style="margin-top: var(--sys-layout-control-gap); font: var(--sys-type-meta);">
      <a class="ytd-note-toast-copy" href="${escapeHtmlForContent(note.timestampedUrl)}" aria-label="${escapeHtmlForContent(t("host.copyNoteLink"))}" style="color: var(--sys-action-primary-bg); font-weight: 600; text-decoration: none;">🔗 ${escapeHtmlForContent(t("host.copyLink"))}</a>
      <span class="ytd-note-toast-copy-status" role="status" aria-live="polite" aria-atomic="true" style="display: block; margin-top: var(--sys-layout-inline-gap);"></span>
    </div>
  `;

  toast.style.cssText = `
    position: fixed;
    bottom: var(--sys-layout-panel-inset);
    right: var(--sys-layout-panel-inset);
    z-index: 999999;
    background: var(--comp-toast-bg);
    border: 1px solid var(--comp-toast-border);
    border-radius: var(--comp-toast-radius);
    padding: var(--sys-layout-panel-inset);
    box-sizing: border-box;
    width: min(350px, calc(100vw - 24px));
    max-width: 350px;
    box-shadow: var(--sys-elevation-overlay);
    font-family: var(--sys-font-ui);
  `;

  const copyLink = toast.querySelector(".ytd-note-toast-copy");
  const copyStatus = toast.querySelector(".ytd-note-toast-copy-status");
  let isCopying = false;

  // Copy link feedback belongs to this existing success Toast and only settles
  // when the real Clipboard request resolves or rejects.
  copyLink.addEventListener("click", async (e) => {
    e.preventDefault();
    if (isCopying) return;

    isCopying = true;
    copyLink.textContent = t("host.copyingNoteLink");
    copyLink.setAttribute("aria-disabled", "true");
    copyLink.style.pointerEvents = "none";
    copyStatus.textContent = t("host.copyingNoteLink");

    try {
      await navigator.clipboard.writeText(note.timestampedUrl);
      copyLink.textContent = `✓ ${t("host.linkCopied")}`;
      copyLink.setAttribute("aria-label", t("host.copyNoteLinkAgain"));
      copyStatus.textContent = t("host.noteLinkCopied");
    } catch (err) {
      copyLink.textContent = `! ${t("host.copyFailed")}`;
      copyLink.setAttribute("aria-label", t("host.retryCopyNoteLink"));
      copyStatus.textContent = t("host.copyNoteLinkFailed");
      console.error("Copy failed:", err);
    } finally {
      isCopying = false;
      copyLink.removeAttribute("aria-disabled");
      copyLink.style.pointerEvents = "auto";
    }
  });

  document.body.appendChild(toast);
  visibleNoteToast = toast;

  // Keep the confirmation visible long enough to read, then remove it so it
  // never blocks the YouTube controls or subsequent page content.
  ytdNoteToastDismissTimer = setTimeout(() => {
    ytdNoteToastDismissTimer = null;
    if (toast.isConnected) {
      toast.remove();
      if (visibleNoteToast === toast) visibleNoteToast = null;
    }
  }, 5000);
}

// ============================================================
// VIDEO INFO EXTRACTION
// ============================================================

/**
 * Reads the video title, channel name, and description directly from YouTube's page.
 * These are just sitting in the HTML — we grab them from the DOM elements.
 */
function extractVideoInfo() {
  // The video title is in an h1 element inside the #title container
  const titleElement = document.querySelector(
    "h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string",
  );

  // The channel name is in the channel info section
  const channelElement = document.querySelector(
    "#channel-name yt-formatted-string a, ytd-channel-name yt-formatted-string a",
  );

  // Video duration from the video element
  const videoElement = document.querySelector("video.html5-main-video");

  // Video description — YouTube has this in a few possible places
  const descriptionElement = document.querySelector(
    "#description-inner, " +
      "ytd-watch-metadata #description yt-attributed-string, " +
      "#description yt-formatted-string, " +
      "ytd-expander#description yt-attributed-string",
  );

  return {
    title: titleElement?.textContent?.trim() || "",
    channelName: channelElement?.textContent?.trim() || "",
    duration: videoElement?.duration || 0,
    description: descriptionElement?.textContent?.trim() || "",
  };
}

// ============================================================
// PROGRESS BAR KEY MOMENTS
// ============================================================

/**
 * Adds colored marker dots to YouTube's video progress bar
 * at the positions of key moments identified by the AI provider.
 *
 * How it works:
 * - YouTube's progress bar is a <div> element with a known class
 * - We calculate each moment's position as a percentage of total duration
 * - We inject small colored <div> elements at those positions
 * - The markers are absolutely positioned on top of the progress bar
 *
 * This is a "bonus feature" — it gives you a visual preview
 * of where the good stuff is in the video.
 */
function highlightKeyMoments(moments, videoDuration) {
  // Disabled: no timeline markers. Chapters live only in the side panel.
  return;
}

// ============================================================
// SEEK TO TIMESTAMP
// ============================================================

/**
 * Jumps the YouTube video to a specific timestamp (in seconds).
 * This is called when the user clicks a timestamp in the side panel.
 *
 * We simply set the video element's .currentTime property,
 * which is the standard HTML5 way to seek in a video.
 */
function seekToTimestamp(seconds) {
  const video = document.querySelector("video.html5-main-video");
  if (!video) {
    console.error("[YouTube Digest Content] No video element found for seek");
    return;
  }

  debugLog("[YouTube Digest Content] Seeking to:", seconds);
  video.currentTime = seconds;
  // Also play the video if it's paused
  if (video.paused) {
    video.play().catch(() => {}); // Ignore autoplay errors
  }
}

function escapeHtmlForContent(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// ============================================================
// PAGE NAVIGATION DETECTION
// ============================================================

/**
 * YouTube is a "Single Page Application" (SPA). This means when you
 * click on a new video, the page doesn't fully reload — YouTube
 * dynamically swaps out the content. So our content script stays alive
 * but needs to detect when the video changes.
 *
 * We watch for URL changes using the `yt-navigate-finish` event,
 * which YouTube fires after navigation completes. When that happens,
 * we clean up old markers and re-inject the button.
 */
document.addEventListener("yt-navigate-finish", () => {
  hostPageLifecycleEpoch += 1;

  // Clean up old key moment markers when navigating to a new video
  const existingMarkers = document.querySelectorAll(".ytd-key-moment-markers");
  existingMarkers.forEach((m) => m.remove());

  // Remove old buttons (they will be re-injected for the new video)
  document
    .querySelectorAll("#ytd-digest-button")
    .forEach((button) => button.remove());
  ytdDigestButton = null;
  if (digestButtonReconcileTimer) {
    clearTimeout(digestButtonReconcileTimer);
    digestButtonReconcileTimer = null;
  }

  document
    .querySelectorAll("#ytd-note-button")
    .forEach((button) => button.remove());

  // Reset note button state
  ytdNoteButton = null;
  clearTimeout(ytdNoteButtonTimer);
  ytdNoteButtonTimer = null;
  clearTimeout(ytdNoteButtonFeedbackTimer);
  ytdNoteButtonFeedbackTimer = null;
  if (ytdNoteButtonRetryTimer) {
    clearInterval(ytdNoteButtonRetryTimer);
    ytdNoteButtonRetryTimer = null;
  }

  // Remove any toasts
  document
    .querySelectorAll("#ytd-note-toast")
    .forEach((toast) => toast.remove());
  clearTimeout(ytdNoteToastDismissTimer);
  ytdNoteToastDismissTimer = null;

  // Re-inject buttons for the new video (with a small delay for YouTube to render)
  setTimeout(() => {
    scheduleDigestButtonReconciliation(0);
    tryInjectNoteButton();
  }, 500);
});
