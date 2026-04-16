const test = require("node:test");
const assert = require("node:assert/strict");
const wideCharPattern =
  /[\u1100-\u115F\u231A-\u231B\u2329-\u232A\u23E9-\u23EC\u23F0\u23F3\u25FD-\u25FE\u2614-\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA-\u26AB\u26BD-\u26BE\u26C4-\u26C5\u26CE\u26D4\u26EA\u26F2-\u26F3\u26F5\u26FA\u26FD\u2705\u270A-\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B-\u2B1C\u2B50\u2B55\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6]/u;
const emojiPattern = /\p{Extended_Pictographic}/u;

const {
  buildCompactStatusText,
  buildCompactTooltipTable,
  buildCompactTooltipLines,
  formatEnglishCountdownFriendly,
  formatEnglishDurationCompact,
  getCompactTooltipLabels,
  selectCompactProgressColor,
  selectCompactStatusIcon,
  selectCompactStateIcon,
} = require("../out/compactView.js");

test("formatEnglishDurationCompact uses English short units", () => {
  assert.equal(formatEnglishDurationCompact(4 * 60 * 60 * 1000), "4h");
  assert.equal(formatEnglishDurationCompact(3 * 24 * 60 * 60 * 1000), "3d");
  assert.equal(formatEnglishDurationCompact(32 * 60 * 1000), "32m");
});

test("formatEnglishCountdownFriendly uses English short units", () => {
  const now = Date.UTC(2026, 3, 16, 12, 0, 0);
  assert.equal(
    formatEnglishCountdownFriendly(now + (3 * 60 * 60 + 32 * 60) * 1000, now),
    "3h32m",
  );
  assert.equal(
    formatEnglishCountdownFriendly(now + (3 * 24 * 60 * 60 + 3 * 60 * 60) * 1000, now),
    "3d3h",
  );
});

test("buildCompactStatusText renders the approved simplified status bar text", () => {
  assert.equal(
    buildCompactStatusText({
      icon: "$(zap)",
      currentPercent: 5,
      currentResetLabel: "3h13m",
      weeklyPercent: 31,
      weeklyResetLabel: "3d13m",
    }),
    "$(zap) 5% (3h13m) · W 31% (3d13m)",
  );
});

test("selectCompactStatusIcon restores risk-aware status icons", () => {
  assert.equal(selectCompactStatusIcon({ currentPercent: 5, weeklyPercent: 31 }), "$(zap)");
  assert.equal(selectCompactStatusIcon({ currentPercent: 72, weeklyPercent: 31 }), "$(warning)");
  assert.equal(selectCompactStatusIcon({ currentPercent: 5, weeklyPercent: 75 }), "$(warning)");
  assert.equal(selectCompactStatusIcon({ currentPercent: 92, weeklyPercent: 31 }), "$(error)");
});

test("selectCompactProgressColor follows the same warning thresholds", () => {
  assert.equal(selectCompactProgressColor(5), "#52c41a");
  assert.equal(selectCompactProgressColor(72), "#faad14");
  assert.equal(selectCompactProgressColor(92), "#ff4d4f");
});

test("selectCompactStateIcon keeps non-normal states on the same icon semantics", () => {
  assert.equal(selectCompactStateIcon("refreshing"), "$(sync~spin)");
  assert.equal(selectCompactStateIcon("waiting"), "$(sync)");
  assert.equal(selectCompactStateIcon("missingKey"), "$(key)");
  assert.equal(selectCompactStateIcon("error"), "$(error)");
});

test("getCompactTooltipLabels removes emoji icons to avoid visual drift in VS Code tooltip", () => {
  assert.deepEqual(getCompactTooltipLabels("zh-CN"), {
    current: "当前周期:",
    weekly: "本周累计:",
  });
  assert.deepEqual(getCompactTooltipLabels("en"), {
    current: "Current:",
    weekly: "Weekly:",
  });
});

test("buildCompactTooltipLines keeps two aligned progress rows", () => {
  const lines = buildCompactTooltipLines({
    currentLabel: "⚡ 当前周期:",
    currentUsed: 46,
    currentTotal: 1500,
    currentPercent: 3,
    weeklyLabel: "📅 本周累计:",
    weeklyUsed: 4668,
    weeklyTotal: 15000,
    weeklyPercent: 31,
  });

  assert.equal(lines.length, 2);
  assert.match(lines[0], /^⚡ 当前周期:/);
  assert.match(lines[1], /^📅 本周累计:/);
  assert.ok(lines[0].includes("46/1,500"));
  assert.ok(lines[1].includes("4,668/15,000"));
  assert.equal(
    getDisplayWidth(lines[0].slice(0, lines[0].indexOf("["))),
    getDisplayWidth(lines[1].slice(0, lines[1].indexOf("["))),
  );
  assert.equal(
    getDisplayWidth(lines[0].slice(0, lines[0].lastIndexOf("%") + 1)),
    getDisplayWidth(lines[1].slice(0, lines[1].lastIndexOf("%") + 1)),
  );
});

test("buildCompactTooltipLines is stable for identical usage data", () => {
  const input = {
    currentLabel: "⚡ 当前周期:",
    currentUsed: 46,
    currentTotal: 1500,
    currentPercent: 3,
    weeklyLabel: "📅 本周累计:",
    weeklyUsed: 4668,
    weeklyTotal: 15000,
    weeklyPercent: 31,
  };

  const first = buildCompactTooltipLines(input).join("\n");
  const second = buildCompactTooltipLines(input).join("\n");

  assert.equal(first, second);
});

test("buildCompactTooltipTable renders aligned html rows with colored progress spans", () => {
  const table = buildCompactTooltipTable({
    currentLabel: "Current:",
    currentUsed: 74,
    currentTotal: 1500,
    currentPercent: 5,
    weeklyLabel: "Weekly:",
    weeklyUsed: 4696,
    weeklyTotal: 15000,
    weeklyPercent: 75,
  });

  assert.match(table, /^<table><tbody>/);
  assert.equal((table.match(/<tr>/g) || []).length, 2);
  assert.ok(table.includes('<td><code>Current:</code></td>'));
  assert.ok(table.includes('<td align="right"><code>4,696/15,000</code></td>'));
  assert.ok(table.includes('style="color:#52c41a;"'));
  assert.ok(table.includes('style="color:#faad14;"'));
  assert.ok(table.includes('<td align="right"><code>75%</code></td>'));
});

function getDisplayWidth(value) {
  let width = 0;
  for (const char of value) {
    width += emojiPattern.test(char) || wideCharPattern.test(char) ? 2 : 1;
  }
  return width;
}
