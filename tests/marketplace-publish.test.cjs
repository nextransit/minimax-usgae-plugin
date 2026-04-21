const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildExpectedTag,
  collectReleaseErrors,
} = require("../scripts/publish-marketplace.cjs");

test("buildExpectedTag derives the Git tag from package version", () => {
  assert.equal(buildExpectedTag("0.0.7"), "v0.0.7");
  assert.equal(buildExpectedTag("1.2.3"), "v1.2.3");
});

test("collectReleaseErrors accepts matching tag, publisher and PAT", () => {
  assert.deepEqual(
    collectReleaseErrors({
      version: "0.0.7",
      tag: "v0.0.7",
      publisher: "Decard",
      pat: "secret",
      requireTagMatch: true,
    }),
    [],
  );
});

test("collectReleaseErrors rejects mismatched tag", () => {
  assert.deepEqual(
    collectReleaseErrors({
      version: "0.0.7",
      tag: "v0.0.8",
      publisher: "Decard",
      pat: "secret",
      requireTagMatch: true,
    }),
    ['Git tag "v0.0.8" does not match package version "0.0.7" (expected "v0.0.7").'],
  );
});

test("collectReleaseErrors reports missing publisher and PAT", () => {
  assert.deepEqual(
    collectReleaseErrors({
      version: "0.0.7",
      tag: "",
      publisher: "",
      pat: "",
      requireTagMatch: false,
    }),
    [
      "package.json publisher is required for Marketplace publishing.",
      "VSCE_PAT is required for Marketplace publishing.",
    ],
  );
});
