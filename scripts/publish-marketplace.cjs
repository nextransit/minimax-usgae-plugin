#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

function buildExpectedTag(version) {
  return `v${version}`;
}

function collectReleaseErrors({ version, tag, publisher, pat, requireTagMatch, requirePat = true }) {
  const errors = [];

  if (!publisher) {
    errors.push("package.json publisher is required for Marketplace publishing.");
  }

  if (requirePat && !pat) {
    errors.push("VSCE_PAT is required for Marketplace publishing.");
  }

  if (requireTagMatch) {
    const expectedTag = buildExpectedTag(version);
    if (tag !== expectedTag) {
      errors.push(
        `Git tag "${tag}" does not match package version "${version}" (expected "${expectedTag}").`,
      );
    }
  }

  return errors;
}

function readPackageManifest() {
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

function maskPatForLog(pat) {
  return pat ? "***" : "";
}

function run() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const manifest = readPackageManifest();
  const tag = process.env.CI_COMMIT_TAG || "";
  const pat = process.env.VSCE_PAT || "";
  const errors = collectReleaseErrors({
    version: manifest.version,
    tag,
    publisher: manifest.publisher,
    pat,
    requireTagMatch: Boolean(tag),
    requirePat: !dryRun,
  });

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const commandArgs = ["vsce", "publish", "--pat", pat, "--allow-missing-repository"];

  if (dryRun) {
    const logArgs = ["vsce", "publish", "--pat", maskPatForLog(pat), "--allow-missing-repository"];
    console.log(`Dry run: npx ${logArgs.join(" ")}`);
    return;
  }

  const result = cp.spawnSync("npx", commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (typeof result.status === "number") {
    process.exitCode = result.status;
    return;
  }

  process.exitCode = 1;
}

module.exports = {
  buildExpectedTag,
  collectReleaseErrors,
  maskPatForLog,
};

if (require.main === module) {
  run();
}
