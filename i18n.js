var YTD_I18N = (() => {
  const LANGUAGE_STORAGE_KEY = "ytd_options_language";
  const DEFAULT_LANGUAGE = "en";
  const SUPPORTED_LANGUAGES = new Set(["en", "zh-CN"]);
  const COPY = Object.freeze({
    en: {
      pageTitle: "YouTube Digest Settings",
      languageGroupLabel: "Interface language",
      heading: "Bring your own API keys",
      lede:
        "Keys stay in this Chrome profile and are sent only to Supadata and DeepSeek. This open-source extension has no developer server or analytics.",
      transcriptProvider: "Transcript provider",
      supadataApiKeyLabel: "Supadata API key",
      supadataHelp: "Used to fetch timestamped YouTube subtitles. ",
      supadataLink: "Create a Supadata account and key",
      supadataHelpSuffix: ". Supadata generates the key during onboarding.",
      aiProvider: "AI provider",
      providerSummaryLabel: "Supported AI provider",
      providerBadge: "Supported in this version",
      deepseekApiKeyLabel: "DeepSeek API key",
      deepseekHelp:
        "YouTube Digest uses DeepSeek V4 Flash for overviews, explanations, translation, and note polishing. ",
      deepseekLink: "Create a DeepSeek API key",
      deepseekHelpSuffix: ".",
      privacyNote:
        "When you use AI features, DeepSeek receives the video transcript and relevant video context. Review DeepSeek's terms and pricing before saving.",
      saveSettings: "Save settings",
      localRemix: "Local remix",
      customizationTitle: "Want to use another AI model?",
      customizationPurpose: "Edit and copy a safe prompt for your coding agent",
      agentBadge: "Coding agent ready",
      customizationIntro:
        "You can edit the prompt directly. Complete these three steps before copying:",
      customizationStepFolder:
        "Open the extracted YouTube Digest project folder in your coding agent.",
      customizationStepReplace:
        "Replace [PROVIDER] and [MODEL] with the service and model you want to use.",
      customizationStepKeys:
        "Never include API keys in the prompt or chat. Enter them yourself after the code is ready.",
      customizationPromptLabel: "Editable customization prompt",
      customizationReminderLabel: "Prompt reminder",
      customizationReminder:
        "Before copying, replace [PROVIDER] and [MODEL] with the provider and model you want to use.",
      customizationPrompt:
        "Customize this local YouTube Digest workspace to use [PROVIDER] with [MODEL]. Work only in the current workspace. Before editing, verify that it contains manifest.json and that the manifest name is YouTube Digest. If verification fails, stop and ask me to open the extracted YouTube Digest project folder in my coding agent. Do not search other folders, edit a guessed copy, assume an installation path, or claim Chrome can reveal the absolute OS source path. Update the provider's API endpoint, request format, and minimum Chrome host permissions. Preserve bring-your-own-key and local Chrome storage. Never put API keys in source code, commits, logs, screenshots, this prompt, or chat; after the code is ready, tell me where to enter the key myself. Keep DeepSeek-only request fields and retry behavior isolated to DeepSeek. Handle provider-specific rules separately so one provider does not affect another. Update README.md, README.zh-CN.md, PRIVACY.md, SECURITY.md, and tests. Run npm test, npm run check, and npm run package. Then explain how to reload the unpacked extension and test it on a real YouTube video.",
      copyCustomizationPrompt: "Copy edited prompt",
      localData: "Local data",
      localDataHelp:
        "Digests, translations, and notes are stored only in this Chrome profile. You can remove them at any time.",
      clearCache: "Clear cached digests",
      deleteNotes: "Delete all notes",
      resetData: "Reset extension data",
      footer:
        'Read <a href="PRIVACY.md" target="_blank">PRIVACY.md</a> in the repository for the complete data-flow description.',
      migrationWarning:
        "Custom provider settings were removed safely. Your Supadata key was kept, but the AI key was cleared. Enter a DeepSeek API key to continue.",
      loadingSettings: "Loading saved settings…",
      saving: "Saving…",
      addSupadataKey: "Add a Supadata API key.",
      addDeepseekKey: "Add a DeepSeek API key.",
      saved: "Saved. Reopen YouTube Digest to use these settings.",
      saveFailed: "Could not save settings. Please try again.",
      copying: "Copying…",
      promptCopied: "Edited prompt copied.",
      copyFailed:
        "Could not copy the prompt. Select the prompt text and copy it manually.",
      clearingCache: "Clearing cached digests…",
      clearedDigests: ({ count }) =>
        `Cleared ${count} cached digest${count === 1 ? "" : "s"}.`,
      clearCacheFailed: "Could not clear cached digests. Please try again.",
      deletingNotes: "Deleting all saved notes…",
      notesDeleted: "Deleted all saved notes.",
      deleteNotesFailed: "Could not delete saved notes. Please try again.",
      resettingData: "Resetting extension data…",
      resetConfirm:
        "Delete API keys, cached digests, translations, and saved notes from this Chrome profile?",
      allDataDeleted: "All YouTube Digest data was deleted.",
      resetFailed: "Could not reset extension data. Please try again.",
      settingsLoadFailed:
        "Could not load saved settings. You can still preview this page.",
      "sidepanel.tabTranscript": "Transcript",
      "sidepanel.tabOverview": "Overview",
      "sidepanel.tabNotes": "Notes",
      "sidepanel.pageTitle": "YouTube Digest",
      "sidepanel.openSettings": "Open YouTube Digest settings",
      "sidepanel.tabsLabel": "Digest views",
      "sidepanel.transcriptControls": "Transcript controls",
      "sidepanel.transcriptLanguage": "Transcript language",
      "sidepanel.copyTranscript": "Copy transcript",
      "sidepanel.exportTranscript": "Export transcript",
      "sidepanel.translationInProgress": "Translation in progress",
      "sidepanel.welcomeTitle": "Ready to Digest",
      "sidepanel.welcomeDescription":
        "Navigate to a YouTube video and click the extension icon to get an AI-powered digest.",
      "sidepanel.loadingTranscript": "Fetching transcript",
      "sidepanel.loadingCaptions": "Extracting captions from video…",
      "sidepanel.errorTitle": "Error",
      "sidepanel.errorMessage": "Something went wrong.",
      "sidepanel.retry": "Try Again",
      "transcript.modeOriginal": "Original",
      "transcript.modeChinese": "Chinese",
      "transcript.modeBilingual": "Bilingual",
      "transcript.fromVideoSubtitles": "From video subtitles",
      "transcript.originalWithLanguage": ({ language }) =>
        `Original (${language})`,
      "transcript.sourceChinese": ({ original }) =>
        `Simplified Chinese · translated from ${original}`,
      "transcript.sourceBilingual": ({ original }) =>
        `${original} + Simplified Chinese`,
      "transcript.playFrom": ({ timestamp }) => `Play from ${timestamp}`,
      "transcript.currentlyPlaying": ({ timestamp }) =>
        `Currently playing from ${timestamp}. Activate to play from this timestamp.`,
      "transcript.waiting": "Waiting for translation…",
      "transcript.retrying": "Retrying…",
      "transcript.retry": "Retry",
      "transcript.unavailable": "Translation unavailable.",
      "transcript.failed": "Translation failed.",
      "overview.readyTitle": "Overview is ready when you open this tab.",
      "overview.readyMessage":
        "Chapters and key quotes load only after you select Overview.",
      "overview.loadingChapters": "Loading chapters",
      "overview.chapters": "Chapters",
      "overview.chaptersPlaceholder": "Chapters will appear here",
      "overview.keyQuotes": "Key Quotes",
      "overview.loadingQuotes": "Loading quotes",
      "overview.quotesPlaceholder":
        "Quotes will be extracted when you view this tab…",
      "overview.noChapters": "No chapters were returned for this video.",
      "overview.noQuotes": "No key quotes were returned for this video.",
      "overview.playFromTitle": ({ timestamp, title }) =>
        `Play from ${timestamp}: ${title}`,
      "overview.currentlySelected": ({ timestamp, title }) =>
        `Currently selected at ${timestamp}: ${title}`,
      "overview.saveQuote": "Note",
      "overview.saveQuoteTitle": "Save this quote as a note",
      "overview.copyQuote": "Copy",
      "overview.copyQuoteTitle": "Copy this quote",
      "overview.copying": "Copying…",
      "overview.copyingQuote": "Copying this quote…",
      "overview.quoteCopied": "Quote copied.",
      "overview.retryCopy": "Retry copy",
      "overview.copyQuoteFailed":
        "Could not copy the quote. Select the quote text to copy it manually, or try again.",
      "overview.saving": "Saving…",
      "overview.savingQuote": "Saving this quote as a note…",
      "overview.quoteSaved": "Quote saved to this video's notes.",
      "overview.retrySave": "Retry save",
      "overview.saveQuoteFailed": "Could not save this quote. Try again.",
      "overview.saveQuoteFailedWithError": ({ error }) =>
        `Could not save this quote: ${error}`,
      "overview.unavailableTitle": "Overview could not be created",
      "overview.unavailableMessage":
        "Try again to request chapters and key quotes.",
      "overview.retry": "Retry overview",
      "notes.savedTitle": "Saved Notes",
      "notes.filterLabel": "Saved notes filter",
      "notes.thisVideo": "This Video",
      "notes.all": "All Notes",
      "notes.introBefore": "Move your mouse over the video and click the",
      "notes.introAfter":
        'Note button to save timestamped notes, or press the "n" key while the video is focused.',
      "notes.noneForVideo": "No notes for this video yet. Hover over the video and click",
      "notes.none": "No notes saved yet. Hover over a video and click",
      "notes.noneSuffix": "Note to save.",
      "notes.copyText": "Text",
      "notes.copyTimestamp": "Timestamp",
      "notes.play": "Play",
      "notes.openAt": ({ timestamp }) => `Open note at ${timestamp}`,
      "notes.delete": "Delete note",
      "notes.removing": "Removing note…",
      "notes.retryDelete": "Retry",
      "notes.retryDeleting": "Retry deleting note",
      "notes.deleteFailed": "Could not delete this note. Retry.",
      "notes.deleteFailedWithError": ({ error }) =>
        `Could not delete this note: ${error}`,
      "notes.copying": "Copying…",
      "notes.copyingText": "Copying note text…",
      "notes.textCopied": "Note text copied.",
      "notes.retryCopy": "Retry copy",
      "notes.copyTextFailed":
        "Could not copy the note text. Select the note text to copy it manually, or try again.",
      "notes.copyingTimestamp": "Copying timestamp link…",
      "notes.timestampCopied": "Timestamp link copied.",
      "notes.copyTimestampFailed":
        "Could not copy the timestamp link. Select the link below to copy it manually, or try again.",
      "follow.resume": "Resume following playback",
      "follow.follow": "Follow playback",
      "follow.paused":
        "Following playback is paused. Activate Follow playback to resume.",
      "follow.following": "Following playback.",
      "explain.action": "Explain",
      "explain.close": "Close explanation",
      "explain.loading": "Analyzing selected text…",
      "explain.unavailable": "Explanation unavailable",
      "explain.retryMessage": "Try again to explain the selected text.",
      "explain.retry": "Retry explanation",
      "host.noteSaved": "Note saved",
      "host.copyLink": "Copy link",
      "host.open": "Open YouTube Digest",
      "host.digest": "Digest",
      "host.note": "Note",
      "host.saveNote": "Save a note at the current time",
      "host.saving": "Saving",
      "host.saved": "Saved",
      "host.noteSaveFailed": "Could not save note. Try again.",
      "host.copyNoteLink": "Copy note link",
      "host.copyingNoteLink": "Copying link…",
      "host.linkCopied": "Link copied",
      "host.copyNoteLinkAgain": "Copy note link again",
      "host.noteLinkCopied": "Note link copied.",
      "host.copyFailed": "Copy failed - try again",
      "host.retryCopyNoteLink": "Try copying note link again",
      "host.copyNoteLinkFailed":
        "Could not copy the note link. Try again or copy the link address manually.",
      "sidepanel.apiKeysMissing": "API Keys Missing",
      "sidepanel.configureKeys": ({ providers }) =>
        `Add your ${providers} API key${providers.includes(" and ") ? "s" : ""} in YouTube Digest Settings.`,
      "sidepanel.openSettingsAction": "Open Settings",
      "sidepanel.noTranscript": "No transcript found",
      "sidepanel.invalidSupadataKey":
        "Your Supadata API key is invalid. Open Settings and try again.",
      "sidepanel.rateLimited":
        "Supadata rate limit reached. Please wait a minute and try again.",
      "sidepanel.aiUnavailable": "The AI request could not be completed. Please try again.",
      "export.transcript": "TRANSCRIPT",
      "export.title": "Title",
      "export.channel": "Channel",
      "export.url": "URL",
      "export.description": "DESCRIPTION",
      "export.unknown": "Unknown",
      "export.credit": "Exported by YouTube Digest",
      "sidepanel.unknownError": "Something went wrong.",
      "sidepanel.copyingTranscript": "Copying transcript",
      "sidepanel.transcriptCopied": "Transcript copied",
      "sidepanel.retryCopyTranscript": "Retry copying transcript",
      "overview.copied": "Copied",
      "overview.quoteCopiedAria": "Quote copied",
      "overview.retryCopyQuote": "Retry copying this quote",
      "overview.saved": "Saved",
      "overview.quoteSavedAria": "Quote saved to notes",
      "overview.retrySaveQuote": "Retry saving this quote",
      "notes.copied": "Copied",
      "notes.textCopiedAria": "Note text copied",
      "notes.retryCopyText": "Retry copying note text",
      "notes.timestampCopiedAria": "Timestamp link copied",
      "notes.retryCopyTimestamp": "Retry copying timestamp link",
      "notes.removingAria": "Removing note",
      "notes.retryDeletingAria": "Retry deleting note",
      "explain.failed": "Failed to get an explanation.",
    },
    "zh-CN": {
      pageTitle: "YouTube Digest 设置",
      languageGroupLabel: "界面语言",
      heading: "使用你自己的 API 密钥",
      lede:
        "密钥仅保存在当前 Chrome 个人资料中，只会发送给 Supadata 和 DeepSeek。本开源扩展没有开发者服务器，也不使用分析服务。",
      transcriptProvider: "字幕服务",
      supadataApiKeyLabel: "Supadata API 密钥",
      supadataHelp: "用于获取带时间戳的 YouTube 字幕。",
      supadataLink: "创建 Supadata 账号并获取密钥",
      supadataHelpSuffix: "。Supadata 会在引导流程中生成密钥。",
      aiProvider: "AI 服务",
      providerSummaryLabel: "支持的 AI 服务",
      providerBadge: "当前版本支持",
      deepseekApiKeyLabel: "DeepSeek API 密钥",
      deepseekHelp:
        "YouTube Digest 使用 DeepSeek V4 Flash 生成概览、解释内容、翻译字幕和润色笔记。",
      deepseekLink: "创建 DeepSeek API 密钥",
      deepseekHelpSuffix: "。",
      privacyNote:
        "使用 AI 功能时，DeepSeek 会收到视频字幕及相关视频上下文。保存前请查看 DeepSeek 的服务条款和价格。",
      saveSettings: "保存设置",
      localRemix: "本地改造",
      customizationTitle: "想使用其他 AI 模型？",
      customizationPurpose: "编辑并复制一段可安全交给编程 Agent 的提示词",
      agentBadge: "可交给编程 Agent",
      customizationIntro: "你可以直接编辑提示词。复制前完成以下三步：",
      customizationStepFolder:
        "在编程 Agent 中打开 YouTube Digest 解压后的项目文件夹。",
      customizationStepReplace:
        "把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
      customizationStepKeys:
        "不要在提示词或聊天中加入 API 密钥。代码准备好后，请自行填写。",
      customizationPromptLabel: "可编辑的自定义提示词",
      customizationReminderLabel: "提示词提醒",
      customizationReminder:
        "复制前，请先把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
      customizationPrompt:
        "请把当前本地 YouTube Digest 工作区改为使用 [PROVIDER] 提供的 [MODEL]。只在当前工作区中操作。编辑前，先确认其中包含 manifest.json，且 manifest 中的 name 是 YouTube Digest。如果验证失败，请停止，并让我在编程 Agent 中打开 YouTube Digest 解压后的项目文件夹。不要搜索其他文件夹，不要编辑猜测的副本，不要假设安装路径，也不要声称 Chrome 可以显示操作系统中的绝对源码路径。更新该服务的 API endpoint、请求格式和最少的 Chrome host permissions。保留用户自带密钥模式和 Chrome 本地存储。不要把 API 密钥写入源代码、提交记录、日志、截图、这段提示词或聊天；代码准备好后，请告诉我应该在哪里自行填写密钥。DeepSeek 专用的请求参数和重试逻辑继续只用于 DeepSeek。新服务的专属规则请单独处理，避免相互影响。更新 README.md、README.zh-CN.md、PRIVACY.md、SECURITY.md 和测试。运行 npm test、npm run check 和 npm run package。最后，说明如何重新加载已解压的扩展，并在真实 YouTube 视频上测试。",
      copyCustomizationPrompt: "复制编辑后的提示词",
      localData: "本地数据",
      localDataHelp:
        "摘要、翻译和笔记仅保存在当前 Chrome 个人资料中。你可以随时删除。",
      clearCache: "清除缓存的摘要",
      deleteNotes: "删除全部笔记",
      resetData: "重置扩展数据",
      footer:
        '完整数据流说明请参阅仓库中的 <a href="PRIVACY.md" target="_blank">PRIVACY.md</a>。',
      migrationWarning:
        "已安全移除自定义服务设置。Supadata 密钥已保留，AI 密钥已清除。请输入 DeepSeek API 密钥以继续使用。",
      loadingSettings: "正在加载已保存的设置…",
      saving: "正在保存…",
      addSupadataKey: "请添加 Supadata API 密钥。",
      addDeepseekKey: "请添加 DeepSeek API 密钥。",
      saved: "已保存。请重新打开 YouTube Digest 以使用这些设置。",
      saveFailed: "无法保存设置，请重试。",
      copying: "正在复制…",
      promptCopied: "已复制编辑后的提示词。",
      copyFailed: "无法复制提示词。请选中提示词文本并手动复制。",
      clearingCache: "正在清除缓存的摘要…",
      clearedDigests: ({ count }) => `已清除 ${count} 条缓存摘要。`,
      clearCacheFailed: "无法清除缓存的摘要，请重试。",
      deletingNotes: "正在删除全部已保存的笔记…",
      notesDeleted: "已删除全部已保存的笔记。",
      deleteNotesFailed: "无法删除已保存的笔记，请重试。",
      resettingData: "正在重置扩展数据…",
      resetConfirm:
        "要从当前 Chrome 个人资料中删除 API 密钥、缓存摘要、翻译和已保存的笔记吗？",
      allDataDeleted: "已删除全部 YouTube Digest 数据。",
      resetFailed: "无法重置扩展数据，请重试。",
      settingsLoadFailed: "无法加载已保存的设置，但你仍可预览此页面。",
      "sidepanel.tabTranscript": "字幕",
      "sidepanel.tabOverview": "概览",
      "sidepanel.tabNotes": "笔记",
      "sidepanel.pageTitle": "YouTube Digest",
      "sidepanel.openSettings": "打开 YouTube Digest 设置",
      "sidepanel.tabsLabel": "摘要视图",
      "sidepanel.transcriptControls": "字幕控制",
      "sidepanel.transcriptLanguage": "字幕语言",
      "sidepanel.copyTranscript": "复制字幕",
      "sidepanel.exportTranscript": "导出字幕",
      "sidepanel.translationInProgress": "正在翻译",
      "sidepanel.welcomeTitle": "可以开始生成摘要",
      "sidepanel.welcomeDescription":
        "打开一个 YouTube 视频，然后点击扩展图标即可生成 AI 摘要。",
      "sidepanel.loadingTranscript": "正在获取字幕",
      "sidepanel.loadingCaptions": "正在提取视频字幕…",
      "sidepanel.errorTitle": "出错了",
      "sidepanel.errorMessage": "出现了一些问题。",
      "sidepanel.retry": "再试一次",
      "transcript.modeOriginal": "原文",
      "transcript.modeChinese": "中文",
      "transcript.modeBilingual": "双语",
      "transcript.fromVideoSubtitles": "来自视频字幕",
      "transcript.originalWithLanguage": ({ language }) => `原文（${language}）`,
      "transcript.sourceChinese": ({ original }) => `简体中文 · 译自 ${original}`,
      "transcript.sourceBilingual": ({ original }) => `${original} + 简体中文`,
      "transcript.playFrom": ({ timestamp }) => `从 ${timestamp} 开始播放`,
      "transcript.currentlyPlaying": ({ timestamp }) =>
        `正在播放 ${timestamp} 起的内容。点击可从此时间开始播放。`,
      "transcript.waiting": "正在等待翻译…",
      "transcript.retrying": "正在重试…",
      "transcript.retry": "重试",
      "transcript.unavailable": "暂无法翻译。",
      "transcript.failed": "翻译失败。",
      "overview.readyTitle": "打开此标签页后即可生成概览。",
      "overview.readyMessage": "选择“概览”后才会加载章节和关键引文。",
      "overview.loadingChapters": "正在加载章节",
      "overview.chapters": "章节",
      "overview.chaptersPlaceholder": "章节将显示在这里",
      "overview.keyQuotes": "关键引文",
      "overview.loadingQuotes": "正在加载引文",
      "overview.quotesPlaceholder": "打开此标签页后将提取引文…",
      "overview.noChapters": "未能为此视频生成章节。",
      "overview.noQuotes": "未能为此视频生成关键引文。",
      "overview.playFromTitle": ({ timestamp, title }) =>
        `从 ${timestamp} 开始播放：${title}`,
      "overview.currentlySelected": ({ timestamp, title }) =>
        `当前选中 ${timestamp}：${title}`,
      "overview.saveQuote": "笔记",
      "overview.saveQuoteTitle": "将此引文保存为笔记",
      "overview.copyQuote": "复制",
      "overview.copyQuoteTitle": "复制此引文",
      "overview.copying": "正在复制…",
      "overview.copyingQuote": "正在复制此引文…",
      "overview.quoteCopied": "引文已复制。",
      "overview.retryCopy": "重试复制",
      "overview.copyQuoteFailed":
        "无法复制此引文。请选中引文文本手动复制，或重试。",
      "overview.saving": "正在保存…",
      "overview.savingQuote": "正在将此引文保存为笔记…",
      "overview.quoteSaved": "引文已保存到此视频的笔记中。",
      "overview.retrySave": "重试保存",
      "overview.saveQuoteFailed": "无法保存此引文，请重试。",
      "overview.saveQuoteFailedWithError": ({ error }) =>
        `无法保存此引文：${error}`,
      "overview.unavailableTitle": "无法生成概览",
      "overview.unavailableMessage": "请重试以获取章节和关键引文。",
      "overview.retry": "重试生成概览",
      "notes.filterLabel": "已保存笔记筛选",
      "notes.thisVideo": "当前视频",
      "notes.all": "全部笔记",
      "notes.introBefore": "将鼠标移到视频上，然后点击",
      "notes.introAfter":
        '笔记按钮以保存带时间戳的笔记；视频聚焦时也可按“n”键。',
      "notes.noneForVideo": "此视频暂无笔记。将鼠标移到视频上并点击",
      "notes.none": "暂无已保存笔记。将鼠标移到视频上并点击",
      "notes.noneSuffix": "笔记即可保存。",
      "notes.savedTitle": "已保存的笔记",
      "notes.copyText": "文本",
      "notes.copyTimestamp": "时间戳",
      "notes.play": "播放",
      "notes.openAt": ({ timestamp }) => `打开 ${timestamp} 的笔记`,
      "notes.delete": "删除笔记",
      "notes.removing": "正在删除笔记…",
      "notes.retryDelete": "重试",
      "notes.retryDeleting": "重试删除笔记",
      "notes.deleteFailed": "无法删除此笔记，请重试。",
      "notes.deleteFailedWithError": ({ error }) => `无法删除此笔记：${error}`,
      "notes.copying": "正在复制…",
      "notes.copyingText": "正在复制笔记文本…",
      "notes.textCopied": "笔记文本已复制。",
      "notes.retryCopy": "重试复制",
      "notes.copyTextFailed":
        "无法复制笔记文本。请选中笔记文本手动复制，或重试。",
      "notes.copyingTimestamp": "正在复制时间戳链接…",
      "notes.timestampCopied": "时间戳链接已复制。",
      "notes.copyTimestampFailed":
        "无法复制时间戳链接。请选中下方链接手动复制，或重试。",
      "follow.resume": "恢复跟随播放",
      "follow.follow": "跟随播放",
      "follow.paused": "已暂停跟随播放。点击“跟随播放”即可恢复。",
      "follow.following": "正在跟随播放。",
      "explain.action": "解释",
      "explain.close": "关闭解释",
      "explain.loading": "正在分析所选文本…",
      "explain.unavailable": "暂无法提供解释",
      "explain.retryMessage": "请重试解释所选文本。",
      "explain.retry": "重试解释",
      "host.noteSaved": "笔记已保存",
      "host.copyLink": "复制链接",
      "host.open": "打开 YouTube Digest",
      "host.digest": "摘要",
      "host.note": "笔记",
      "host.saveNote": "保存当前时间点的笔记",
      "host.saving": "正在保存",
      "host.saved": "已保存",
      "host.noteSaveFailed": "无法保存笔记，请重试。",
      "host.copyNoteLink": "复制笔记链接",
      "host.copyingNoteLink": "正在复制链接…",
      "host.linkCopied": "链接已复制",
      "host.copyNoteLinkAgain": "再次复制笔记链接",
      "host.noteLinkCopied": "笔记链接已复制。",
      "host.copyFailed": "复制失败，请重试",
      "host.retryCopyNoteLink": "再次尝试复制笔记链接",
      "host.copyNoteLinkFailed":
        "无法复制笔记链接。请重试，或手动复制链接地址。",
      "sidepanel.apiKeysMissing": "缺少 API 密钥",
      "sidepanel.configureKeys": ({ providers }) =>
        `请到 YouTube Digest 设置中添加 ${providers} API 密钥。`,
      "sidepanel.openSettingsAction": "打开设置",
      "sidepanel.noTranscript": "未找到字幕",
      "sidepanel.invalidSupadataKey":
        "Supadata API 密钥无效。请打开设置后重试。",
      "sidepanel.rateLimited": "已达到 Supadata 的速率限制，请稍等一分钟后重试。",
      "sidepanel.aiUnavailable": "无法完成 AI 请求，请重试。",
      "export.transcript": "字幕",
      "export.title": "标题",
      "export.channel": "频道",
      "export.url": "链接",
      "export.description": "简介",
      "export.unknown": "未知",
      "export.credit": "由 YouTube Digest 导出",
      "sidepanel.unknownError": "出现了一些问题。",
      "sidepanel.copyingTranscript": "正在复制字幕",
      "sidepanel.transcriptCopied": "字幕已复制",
      "sidepanel.retryCopyTranscript": "重试复制字幕",
      "overview.copied": "已复制",
      "overview.quoteCopiedAria": "引文已复制",
      "overview.retryCopyQuote": "重试复制此引文",
      "overview.saved": "已保存",
      "overview.quoteSavedAria": "引文已保存到笔记",
      "overview.retrySaveQuote": "重试保存此引文",
      "notes.copied": "已复制",
      "notes.textCopiedAria": "笔记文本已复制",
      "notes.retryCopyText": "重试复制笔记文本",
      "notes.timestampCopiedAria": "时间戳链接已复制",
      "notes.retryCopyTimestamp": "重试复制时间戳链接",
      "notes.removingAria": "正在删除笔记",
      "notes.retryDeletingAria": "重试删除笔记",
      "explain.failed": "获取解释失败。",
    },
  });

  function normalizeLanguage(language) {
    return SUPPORTED_LANGUAGES.has(language) ? language : DEFAULT_LANGUAGE;
  }

  function translate(language, key, params = {}) {
    const value =
      COPY[normalizeLanguage(language)][key] ?? COPY[DEFAULT_LANGUAGE][key] ?? "";
    return typeof value === "function" ? value(params) : value;
  }

  async function readPreferredLanguage(storage) {
    const stored = await storage.get(LANGUAGE_STORAGE_KEY);
    return normalizeLanguage(stored[LANGUAGE_STORAGE_KEY]);
  }

  async function persistPreferredLanguage(storage, language) {
    const normalizedLanguage = normalizeLanguage(language);
    await storage.set({ [LANGUAGE_STORAGE_KEY]: normalizedLanguage });
    return normalizedLanguage;
  }

  function localizeDocument(root, language) {
    const normalizedLanguage = normalizeLanguage(language);
    root.documentElement.lang = normalizedLanguage;

    for (const element of root.querySelectorAll("[data-i18n]")) {
      element.textContent = translate(normalizedLanguage, element.dataset.i18n);
    }
    for (const element of root.querySelectorAll("[data-i18n-html]")) {
      element.innerHTML = translate(normalizedLanguage, element.dataset.i18nHtml);
    }
    for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
      element.setAttribute(
        "aria-label",
        translate(normalizedLanguage, element.dataset.i18nAriaLabel),
      );
    }
    for (const element of root.querySelectorAll("[data-i18n-title]")) {
      element.title = translate(normalizedLanguage, element.dataset.i18nTitle);
    }
    for (const element of root.querySelectorAll("[data-i18n-placeholder]")) {
      element.placeholder = translate(
        normalizedLanguage,
        element.dataset.i18nPlaceholder,
      );
    }
  }

  return {
    COPY,
    DEFAULT_LANGUAGE,
    LANGUAGE_STORAGE_KEY,
    SUPPORTED_LANGUAGES,
    localizeDocument,
    normalizeLanguage,
    persistPreferredLanguage,
    readPreferredLanguage,
    translate,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_I18N;
}
