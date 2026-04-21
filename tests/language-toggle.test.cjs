const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getNextLanguagePreference,
  resolveUiLanguageFromPreference,
} = require("../out/language.js");

test("resolveUiLanguageFromPreference follows the environment when preference is auto", () => {
  assert.equal(resolveUiLanguageFromPreference("auto", "en-us"), "en");
  assert.equal(resolveUiLanguageFromPreference("auto", "zh-cn"), "zh-CN");
});

test("getNextLanguagePreference toggles away from the current resolved language", () => {
  assert.equal(getNextLanguagePreference("auto", "en-us"), "zh-CN");
  assert.equal(getNextLanguagePreference("auto", "zh-cn"), "en");
  assert.equal(getNextLanguagePreference("en", "zh-cn"), "zh-CN");
  assert.equal(getNextLanguagePreference("zh-CN", "en-us"), "en");
});
