const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const surfaces = {
  sidePanel: read("sidepanel.css"),
  settings: read("options.css"),
  host: read("content.js"),
};

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((channel) =>
    Number.parseInt(channel, 16) / 255,
  );
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

test("DS-01 keeps ref → sys → comp layers traceable across all three surfaces", () => {
  for (const [name, source] of Object.entries(surfaces)) {
    assert.match(source, /--ref-color-brand-red:\s*#ff0000;/, name);
    assert.match(source, /--ref-color-brand-red-strong:\s*#cc0000;/, name);
    assert.match(source, /--ref-color-surface-canvas:\s*#ffffff;/, name);
    assert.match(source, /--ref-color-surface-subtle:\s*#f9f9f9;/, name);
    assert.match(source, /--ref-color-surface-control:\s*#f2f2f2;/, name);
    assert.match(source, /--ref-color-surface-hover:\s*#e5e5e5;/, name);
    assert.match(
      source,
      /--sys-action-primary-bg:\s*var\(--ref-color-brand-red-strong\);/,
      name,
    );
    assert.match(
      source,
      /--sys-state-error-foreground:\s*var\(--ref-color-state-error-foreground\);/,
      name,
    );
    assert.match(
      source,
      /--sys-state-focus-ring-color:\s*var\(--ref-color-focus-ring\);/,
      name,
    );
    assert.match(source, /--sys-font-ui:\s*var\(--ref-font-ui\);/, name);
  }

  assert.match(surfaces.sidePanel, /--comp-panel-canvas:\s*var\(--sys-surface-canvas\);/);
  assert.match(surfaces.settings, /--comp-settings-canvas:\s*var\(--sys-surface-canvas\);/);
  assert.match(surfaces.host, /--comp-host-action-digest-bg:\s*var\(--sys-action-primary-bg\);/);
  assert.doesNotMatch(surfaces.sidePanel, /background:\s*var\(--ref-/);
  assert.doesNotMatch(surfaces.settings, /background:\s*var\(--ref-/);
  assert.doesNotMatch(surfaces.host, /background:\s*var\(--ref-/);
});

test("DS-01 exposes semantic state, focus, reduced-motion, and non-color samples", () => {
  assert.match(
    surfaces.sidePanel,
    /\.transcript-entry\.active-playback\s*\{[^}]*background:\s*var\(--sys-interaction-selected\);[^}]*border-left-color:\s*transparent;[^}]*border-radius:\s*var\(--sys-shape-large-surface\);/,
  );
  assert.match(
    surfaces.sidePanel,
    /\.error-icon\s*\{[^}]*color:\s*var\(--sys-state-error-indicator\);/,
  );
  assert.match(
    surfaces.sidePanel,
    /\.enhance-btn:disabled\s*\{[^}]*background:\s*var\(--sys-state-disabled-surface\);[^}]*cursor:\s*not-allowed;/,
  );
  assert.match(surfaces.sidePanel, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(surfaces.settings, /\.privacy-note\s*\{[^}]*background:\s*var\(--sys-state-info-surface\);/);
  assert.match(surfaces.settings, /\.prompt-reminder\s*\{[^}]*background:\s*var\(--sys-state-warning-surface\);/);
  assert.match(surfaces.settings, /button:disabled\s*\{[^}]*cursor:\s*not-allowed;/);
  assert.match(
    surfaces.settings,
    /\.customization-summary:focus-visible\s*\{[^}]*outline-offset:\s*var\(--sys-state-focus-ring-offset\);/,
  );
  assert.doesNotMatch(
    surfaces.sidePanel,
    /\.enhance-btn:disabled\s*\{[^}]*opacity:/,
  );
  assert.match(surfaces.host, /background = "var\(--sys-state-success-foreground\)"/);
  assert.match(surfaces.host, /background = "var\(--sys-state-error-foreground\)"/);
  assert.match(surfaces.host, /📝 \$\{escapeHtmlForContent\(t\("host\.noteSaved"\)\)\}/);
  assert.match(surfaces.host, /✓ \$\{t\("host\.linkCopied"\)\}/);

  for (const source of Object.values(surfaces)) {
    assert.match(
      source,
      /--sys-state-focus-ring-width:\s*2px;[\s\S]*?--sys-state-focus-ring-offset:\s*2px;/,
    );
  }
});

test("DS-01 core text and primary action token pairs meet AA contrast", () => {
  assert.ok(contrast("#0f0f0f", "#ffffff") >= 4.5);
  assert.ok(contrast("#606060", "#ffffff") >= 4.5);
  assert.ok(contrast("#ffffff", "#cc0000") >= 4.5);
  assert.ok(contrast("#b3261e", "#fdecea") >= 4.5);
  assert.ok(contrast("#1b6e4f", "#eaf6f0") >= 4.5);
  assert.ok(contrast("#0b5cad", "#eaf2fb") >= 4.5);
});
