const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const options = require("../options.js");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const html = read("options.html");
const css = read("options.css");
const js = read("options.js");
const fixture = JSON.parse(
  read("tests/fixtures/settings-configuration-status.fixture.json"),
);

test("DS-08 fixes English, Simplified Chinese, fields, and long-content inputs", () => {
  assert.deepEqual(fixture.viewports, ["1280x900", "600x900"]);
  assert.deepEqual(fixture.languages, ["en", "zh-CN"]);
  assert.ok(fixture.longContent.englishHelp.length > 140);
  assert.ok(fixture.longContent.chinesePrivacy.length > 60);
  assert.deepEqual(
    fixture.fields.map(({ id, type }) => ({ id, type })),
    [
      { id: "supadataApiKey", type: "password" },
      { id: "aiApiKey", type: "password" },
    ],
  );

  assert.match(
    html,
    /class="segmented-control language-switch"[\s\S]*data-segmented-control[\s\S]*data-language="en"[\s\S]*data-language="zh-CN"/,
  );
  assert.match(
    html,
    /id="supadataApiKey"[\s\S]*type="password"[\s\S]*aria-describedby="supadataApiKeyHelp supadataApiKeyStatus"/,
  );
  assert.match(
    html,
    /id="aiApiKey"[\s\S]*type="password"[\s\S]*aria-describedby="aiApiKeyHelp aiApiKeyStatus"/,
  );
  assert.match(html, /class="provider-summary"[\s\S]*DeepSeek V4 Flash/);
  assert.doesNotMatch(html, /<select\b/i);
  assert.doesNotMatch(html, /id="(?:provider|aiBaseUrl|aiModel)"/);
  assert.doesNotMatch(html, /Show\/Hide|Show key|Hide key/i);
});

test("DS-08 maps every Settings fact to its local status surface", () => {
  assert.deepEqual(
    fixture.statusCases.map(({ key, target, state }) => ({ key, target, state })),
    [
      ["loadingSettings", "configuration", "loading"],
      ["migrationWarning", "configuration", "warning"],
      ["settingsLoadFailed", "configuration", "error"],
      ["addSupadataKey", "supadata", "error"],
      ["addDeepseekKey", "deepseek", "error"],
      ["saving", "save", "loading"],
      ["saved", "save", "success"],
      ["saveFailed", "save", "error"],
    ].map(([key, target, state]) => ({ key, target, state })),
  );
  for (const { key, target, state } of fixture.statusCases) {
    assert.deepEqual(options.getSettingsStatusDescriptor(key), { target, state });
  }

  for (const id of [
    "configurationStatus",
    "supadataApiKeyStatus",
    "aiApiKeyStatus",
    "saveStatus",
  ]) {
    assert.match(
      html,
      new RegExp(`id="${id}"[\\s\\S]*class="[^\"]*status-message[^\"]*"[\\s\\S]*role="status"[\\s\\S]*aria-live="polite"`),
    );
  }
  assert.match(js, /setStatus\(configurationStatus, "loadingSettings"\);[\s\S]*await storage\.get/);
  assert.match(js, /migration\.migrated[\s\S]*await storage\.set[\s\S]*setStatus\(configurationStatus, "migrationWarning"\)/);
  assert.match(js, /setFieldError\([\s\S]*supadataApiKeyStatus,[\s\S]*"addSupadataKey"/);
  assert.match(js, /setFieldError\(aiApiKeyInput, aiApiKeyStatus, "addDeepseekKey"\)/);
  assert.match(js, /setStatus\(saveStatus, "saving"\);[\s\S]*await storage\.set[\s\S]*setStatus\(saveStatus, "saved"\)/);
  assert.match(js, /catch \(_error\) \{[\s\S]*setStatus\(saveStatus, "saveFailed"\)/);
  assert.doesNotMatch(js, /setTimeout\s*\(/);
});

test("DS-08 gives Settings fields, status messages, focus, and reduced motion stable semantics", () => {
  assert.match(css, /\.settings-field input\s*\{[^}]*min-height:\s*44px;/);
  assert.match(css, /\.settings-field input\[aria-invalid="true"\]\s*\{[^}]*border-color:\s*var\(--sys-state-error-border\);/);
  assert.match(css, /\.settings-field input\[aria-invalid="true"\]:focus-visible\s*\{[^}]*border-color:\s*var\(--sys-border-interactive\);/);
  assert.match(css, /\.status-message\[data-state="success"\]/);
  assert.match(css, /\.status-message\[data-state="error"\]/);
  assert.match(css, /\.status-message-icon\s*\{[^}]*border:\s*1px solid currentColor;/);
  assert.match(css, /\.status-message\[data-state="loading"\][\s\S]*content:\s*"…"/);
  assert.match(css, /data-state="loading"\] \.status-message-icon\s*\{[^}]*color:\s*var\(--sys-interaction-loading-indicator\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.language-switch\s*\{[^}]*--segmented-control-option-height:\s*40px;/);
  assert.match(css, /input:focus-visible,[\s\S]*outline-offset:\s*var\(--sys-state-focus-ring-offset\);/);
  assert.match(css, /button\.primary:hover:not\(:disabled\)\s*\{/);
});

test("DS-08 disables only the Save control while the existing write is pending", () => {
  const button = {
    disabled: false,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };

  options.setSavePending(button, true);
  assert.equal(button.disabled, true);
  assert.equal(button.attributes["aria-busy"], "true");

  options.setSavePending(button, false);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes["aria-busy"], "false");

  assert.match(js, /let isSaving = false;/);
  assert.match(js, /if \(isSaving\) return;/);
  assert.match(js, /setSavePending\(saveSettingsBtn, true\);/);
  assert.match(js, /finally \{[\s\S]*setSavePending\(saveSettingsBtn, false\);/);
  const saveFunction = js.match(
    /async function saveSettings\(event\) \{[\s\S]*?\n    \}\n\n    async function copyCustomizationPrompt/,
  );
  assert.ok(saveFunction, "Expected the existing save handler");
  assert.doesNotMatch(
    saveFunction[0],
    /copyCustomizationPromptBtn|clearCacheBtn|clearNotesBtn|resetBtn/,
  );
});
