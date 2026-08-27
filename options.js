const YTD_OPTIONS = (() => {
  const I18N =
    typeof module !== "undefined" && module.exports
      ? require("./i18n.js")
      : YTD_I18N;
  const {
    COPY,
    LANGUAGE_STORAGE_KEY,
    SUPPORTED_LANGUAGES,
  } = I18N;
  const PREVIEW_STORAGE_PREFIX = "youtubeDigestPreview:";
  const SETTINGS_STATUS = Object.freeze({
    loadingSettings: { target: "configuration", state: "loading" },
    migrationWarning: { target: "configuration", state: "warning" },
    settingsLoadFailed: { target: "configuration", state: "error" },
    addSupadataKey: { target: "supadata", state: "error" },
    addDeepseekKey: { target: "deepseek", state: "error" },
    saving: { target: "save", state: "loading" },
    saved: { target: "save", state: "success" },
    saveFailed: { target: "save", state: "error" },
    copying: { target: "copy", state: "loading" },
    promptCopied: { target: "copy", state: "success" },
    copyFailed: { target: "copy", state: "error" },
    clearingCache: { target: "cache", state: "loading" },
    clearedDigests: { target: "cache", state: "success" },
    clearCacheFailed: { target: "cache", state: "error" },
    deletingNotes: { target: "notes", state: "loading" },
    notesDeleted: { target: "notes", state: "success" },
    deleteNotesFailed: { target: "notes", state: "error" },
    resettingData: { target: "reset", state: "loading" },
    allDataDeleted: { target: "reset", state: "success" },
    resetFailed: { target: "reset", state: "error" },
  });

  const normalizeLanguage = I18N.normalizeLanguage;
  const translate = I18N.translate;

  function getSettingsStatusDescriptor(key) {
    return SETTINGS_STATUS[key] || null;
  }

  function setSavePending(button, isPending) {
    setActionPending(button, isPending);
  }

  function setActionPending(button, isPending) {
    button.disabled = isPending;
    button.setAttribute("aria-busy", String(isPending));
  }

  function createStorageAdapter(chromeApi, fallbackStorage) {
    const chromeStorage = chromeApi?.storage?.local;
    const memoryStorage = new Map();

    function fallbackKeys() {
      const keys = [];
      if (!fallbackStorage) return keys;
      try {
        for (let index = 0; index < fallbackStorage.length; index += 1) {
          const key = fallbackStorage.key(index);
          if (key?.startsWith(PREVIEW_STORAGE_PREFIX)) keys.push(key);
        }
      } catch (_error) {
        return [];
      }
      return keys;
    }

    function readFallbackValue(key) {
      try {
        const rawValue = fallbackStorage?.getItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
        );
        if (rawValue !== null && rawValue !== undefined) {
          return JSON.parse(rawValue);
        }
      } catch (_error) {
        // Fall through to memory when localStorage is unavailable or malformed.
      }
      return memoryStorage.get(key);
    }

    function writeFallbackValue(key, value) {
      memoryStorage.set(key, value);
      try {
        fallbackStorage?.setItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
          JSON.stringify(value),
        );
      } catch (_error) {
        // The in-memory copy keeps a restricted preview functional.
      }
    }

    return {
      async get(keys) {
        if (chromeStorage) return chromeStorage.get(keys);

        const requestedKeys =
          keys === null
            ? [
                ...new Set([
                  ...memoryStorage.keys(),
                  ...fallbackKeys().map((key) =>
                    key.slice(PREVIEW_STORAGE_PREFIX.length),
                  ),
                ]),
              ]
            : Array.isArray(keys)
              ? keys
              : [keys];

        return Object.fromEntries(
          requestedKeys
            .map((key) => [key, readFallbackValue(key)])
            .filter(([, value]) => value !== undefined),
        );
      },

      async set(items) {
        if (chromeStorage) return chromeStorage.set(items);
        for (const [key, value] of Object.entries(items)) {
          writeFallbackValue(key, value);
        }
      },

      async remove(keys) {
        if (chromeStorage) return chromeStorage.remove(keys);
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          memoryStorage.delete(key);
          try {
            fallbackStorage?.removeItem(`${PREVIEW_STORAGE_PREFIX}${key}`);
          } catch (_error) {
            // Memory removal is sufficient for this preview session.
          }
        }
      },

      async clear() {
        if (chromeStorage) return chromeStorage.clear();
        memoryStorage.clear();
        for (const key of fallbackKeys()) {
          try {
            fallbackStorage.removeItem(key);
          } catch (_error) {
            // Continue clearing any remaining preview keys.
          }
        }
      },
    };
  }

  const readPreferredLanguage = I18N.readPreferredLanguage;
  const persistPreferredLanguage = I18N.persistPreferredLanguage;

  function updateLanguageButtonState(buttons, language) {
    const normalizedLanguage = normalizeLanguage(language);
    const selected = buttons.find(
      (button) => button.dataset.language === normalizedLanguage,
    );
    const control = selected?.closest?.("[data-segmented-control]");
    if (control && globalThis.YTD_SEGMENTED_CONTROL?.select(control, selected)) {
      return;
    }
    for (const button of buttons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.language === normalizedLanguage),
      );
    }
  }

  function updateLocalizedPrompt(textarea, prompt) {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selectionDirection = textarea.selectionDirection;
    const scrollTop = textarea.scrollTop;
    const scrollLeft = textarea.scrollLeft;

    textarea.value = prompt;

    if (
      Number.isInteger(selectionStart) &&
      Number.isInteger(selectionEnd) &&
      typeof textarea.setSelectionRange === "function"
    ) {
      textarea.setSelectionRange(
        Math.min(selectionStart, prompt.length),
        Math.min(selectionEnd, prompt.length),
        selectionDirection || "none",
      );
    }
    textarea.scrollTop = scrollTop;
    textarea.scrollLeft = scrollLeft;
  }

  function createPromptDrafts() {
    return {
      en: translate("en", "customizationPrompt"),
      "zh-CN": translate("zh-CN", "customizationPrompt"),
    };
  }

  function switchPromptDraft(
    drafts,
    currentLanguage,
    nextLanguage,
    currentValue,
  ) {
    const normalizedCurrentLanguage = normalizeLanguage(currentLanguage);
    const normalizedNextLanguage = normalizeLanguage(nextLanguage);
    drafts[normalizedCurrentLanguage] = String(currentValue ?? "");
    if (typeof drafts[normalizedNextLanguage] !== "string") {
      drafts[normalizedNextLanguage] = translate(
        normalizedNextLanguage,
        "customizationPrompt",
      );
    }
    return {
      language: normalizedNextLanguage,
      prompt: drafts[normalizedNextLanguage],
    };
  }

  async function copyPromptValue(clipboard, value) {
    await clipboard.writeText(value);
  }

  function getSafeLocalStorage(root) {
    try {
      return root.localStorage;
    } catch (_error) {
      return null;
    }
  }

  function initialize(root = globalThis) {
    const doc = root.document;
    const settingsApi = root.YTD_SETTINGS;
    if (!doc || !settingsApi) return;
    root.YTD_SEGMENTED_CONTROL?.initialize(doc);

    const storage = createStorageAdapter(
      root.chrome,
      getSafeLocalStorage(root),
    );
    const form = doc.getElementById("settingsForm");
    const aiApiKeyInput = doc.getElementById("aiApiKey");
    const supadataApiKeyInput = doc.getElementById("supadataApiKey");
    const customizationPrompt = doc.getElementById("customizationPrompt");
    const copyCustomizationPromptBtn = doc.getElementById(
      "copyCustomizationPromptBtn",
    );
    const copyStatus = doc.getElementById("copyStatus");
    const clearCacheBtn = doc.getElementById("clearCacheBtn");
    const clearCacheStatus = doc.getElementById("clearCacheStatus");
    const clearNotesBtn = doc.getElementById("clearNotesBtn");
    const clearNotesStatus = doc.getElementById("clearNotesStatus");
    const resetBtn = doc.getElementById("resetBtn");
    const resetStatus = doc.getElementById("resetStatus");
    const saveStatus = doc.getElementById("saveStatus");
    const saveSettingsBtn = doc.getElementById("saveSettingsBtn");
    const configurationStatus = doc.getElementById("configurationStatus");
    const supadataApiKeyStatus = doc.getElementById("supadataApiKeyStatus");
    const aiApiKeyStatus = doc.getElementById("aiApiKeyStatus");
    const languageButtons = [...doc.querySelectorAll("[data-language]")];
    const statusStates = new Map();
    const promptDrafts = createPromptDrafts();
    let currentLanguage = "en";
    let isSaving = false;
    let isCopying = false;
    let isClearingCache = false;
    let isDeletingNotes = false;
    let isResetting = false;

    function renderStatus(element) {
      const state = statusStates.get(element);
      const statusText = element.querySelector(".status-message-text");
      const text = state
        ? translate(currentLanguage, state.key, state.params)
        : "";

      if (statusText) {
        statusText.textContent = text;
      } else {
        element.textContent = text;
      }
      element.hidden = !state;
      if (state?.state) {
        element.dataset.state = state.state;
      } else {
        delete element.dataset.state;
      }
    }

    function setStatus(element, key, params = {}) {
      if (!key) {
        statusStates.delete(element);
        renderStatus(element);
        return;
      }
      statusStates.set(element, {
        key,
        params,
        state: getSettingsStatusDescriptor(key)?.state,
      });
      renderStatus(element);
    }

    function clearFieldStatus(input, status) {
      input.removeAttribute("aria-invalid");
      setStatus(status, null);
    }

    function setFieldError(input, status, key) {
      input.setAttribute("aria-invalid", "true");
      setStatus(status, key);
    }

    function applyLanguage(language) {
      const nextDraft = switchPromptDraft(
        promptDrafts,
        currentLanguage,
        language,
        customizationPrompt.value,
      );
      currentLanguage = nextDraft.language;
      doc.documentElement.lang = currentLanguage;
      doc.title = translate(currentLanguage, "pageTitle");

      for (const element of doc.querySelectorAll("[data-i18n]")) {
        element.textContent = translate(
          currentLanguage,
          element.dataset.i18n,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-html]")) {
        element.innerHTML = translate(
          currentLanguage,
          element.dataset.i18nHtml,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-aria-label]")) {
        element.setAttribute(
          "aria-label",
          translate(currentLanguage, element.dataset.i18nAriaLabel),
        );
      }

      updateLocalizedPrompt(
        customizationPrompt,
        nextDraft.prompt,
      );
      updateLanguageButtonState(languageButtons, currentLanguage);
      for (const element of statusStates.keys()) renderStatus(element);
    }

    async function loadSettings() {
      setStatus(configurationStatus, "loadingSettings");
      try {
        const stored = await storage.get(settingsApi.STORAGE_KEY);
        const migration = settingsApi.migrateLegacyCustom(
          stored[settingsApi.STORAGE_KEY],
        );
        const settings = migration.settings;

        aiApiKeyInput.value = settings.aiApiKey;
        supadataApiKeyInput.value = settings.supadataApiKey;
        if (migration.migrated) {
          await storage.set({ [settingsApi.STORAGE_KEY]: settings });
          setStatus(configurationStatus, "migrationWarning");
        } else {
          setStatus(configurationStatus, null);
        }
      } catch (_error) {
        setStatus(configurationStatus, "settingsLoadFailed");
      }
    }

    async function loadOptions() {
      try {
        applyLanguage(await readPreferredLanguage(storage));
      } catch (_error) {
        applyLanguage("en");
      }
      await loadSettings();
    }

    async function saveSettings(event) {
      event.preventDefault();
      if (isSaving) return;

      const settings = settingsApi.normalize({
        aiApiKey: aiApiKeyInput.value,
        supadataApiKey: supadataApiKeyInput.value,
      });

      clearFieldStatus(supadataApiKeyInput, supadataApiKeyStatus);
      clearFieldStatus(aiApiKeyInput, aiApiKeyStatus);
      setStatus(saveStatus, null);
      if (!settings.supadataApiKey) {
        setFieldError(
          supadataApiKeyInput,
          supadataApiKeyStatus,
          "addSupadataKey",
        );
        return;
      }
      if (!settings.aiApiKey) {
        setFieldError(aiApiKeyInput, aiApiKeyStatus, "addDeepseekKey");
        return;
      }

      isSaving = true;
      setSavePending(saveSettingsBtn, true);
      setStatus(saveStatus, "saving");
      try {
        await storage.set({ [settingsApi.STORAGE_KEY]: settings });
        setStatus(configurationStatus, null);
        setStatus(saveStatus, "saved");
      } catch (_error) {
        setStatus(saveStatus, "saveFailed");
      } finally {
        isSaving = false;
        setSavePending(saveSettingsBtn, false);
      }
    }

    async function copyCustomizationPrompt() {
      if (isCopying) return;
      isCopying = true;
      setActionPending(copyCustomizationPromptBtn, true);
      setStatus(copyStatus, "copying");
      try {
        await copyPromptValue(
          root.navigator.clipboard,
          customizationPrompt.value,
        );
        setStatus(copyStatus, "promptCopied");
      } catch (_error) {
        setStatus(copyStatus, "copyFailed");
      } finally {
        isCopying = false;
        setActionPending(copyCustomizationPromptBtn, false);
      }
    }

    async function clearCachedDigests() {
      if (isClearingCache) return;
      isClearingCache = true;
      setActionPending(clearCacheBtn, true);
      setStatus(clearCacheStatus, "clearingCache");
      try {
        const all = await storage.get(null);
        const keys = Object.keys(all).filter((key) =>
          key.startsWith("digest_"),
        );
        if (keys.length) await storage.remove(keys);
        setStatus(clearCacheStatus, "clearedDigests", { count: keys.length });
      } catch (_error) {
        setStatus(clearCacheStatus, "clearCacheFailed");
      } finally {
        isClearingCache = false;
        setActionPending(clearCacheBtn, false);
      }
    }

    async function clearNotes() {
      if (isDeletingNotes) return;
      isDeletingNotes = true;
      setActionPending(clearNotesBtn, true);
      setStatus(clearNotesStatus, "deletingNotes");
      try {
        await storage.remove("ytd_notes");
        setStatus(clearNotesStatus, "notesDeleted");
      } catch (_error) {
        setStatus(clearNotesStatus, "deleteNotesFailed");
      } finally {
        isDeletingNotes = false;
        setActionPending(clearNotesBtn, false);
      }
    }

    async function resetAllData() {
      if (isResetting) return;
      const confirmed = root.confirm(
        translate(currentLanguage, "resetConfirm"),
      );
      if (!confirmed) return;

      isResetting = true;
      setActionPending(resetBtn, true);
      setStatus(resetStatus, "resettingData");
      try {
        await storage.clear();
        await persistPreferredLanguage(storage, currentLanguage);
        await loadSettings();
        setStatus(resetStatus, "allDataDeleted");
      } catch (_error) {
        setStatus(resetStatus, "resetFailed");
      } finally {
        isResetting = false;
        setActionPending(resetBtn, false);
      }
    }

    form.addEventListener("submit", saveSettings);
    copyCustomizationPromptBtn.addEventListener(
      "click",
      copyCustomizationPrompt,
    );
    clearCacheBtn.addEventListener("click", clearCachedDigests);
    clearNotesBtn.addEventListener("click", clearNotes);
    resetBtn.addEventListener("click", resetAllData);
    for (const button of languageButtons) {
      button.addEventListener("click", async () => {
        const language = button.dataset.language;
        applyLanguage(language);
        await persistPreferredLanguage(storage, language);
      });
    }
    for (const [input, status] of [
      [supadataApiKeyInput, supadataApiKeyStatus],
      [aiApiKeyInput, aiApiKeyStatus],
    ]) {
      input.addEventListener("input", () => {
        clearFieldStatus(input, status);
        setStatus(saveStatus, null);
      });
    }

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", loadOptions, { once: true });
    } else {
      void loadOptions();
    }
  }

  return {
    COPY,
    LANGUAGE_STORAGE_KEY,
    SETTINGS_STATUS,
    copyPromptValue,
    createPromptDrafts,
    createStorageAdapter,
    getSettingsStatusDescriptor,
    normalizeLanguage,
    persistPreferredLanguage,
    readPreferredLanguage,
    setActionPending,
    setSavePending,
    translate,
    updateLanguageButtonState,
    updateLocalizedPrompt,
    switchPromptDraft,
    initialize,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_OPTIONS;
}

if (typeof document !== "undefined") {
  YTD_OPTIONS.initialize();
}
