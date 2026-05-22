#!/usr/bin/env node
/**
 * Generate update.json for Tauri v2 auto-update.
 *
 * Run inside the GitHub Actions `release` job after artifacts are uploaded.
 * Reads environment variables set by GitHub Actions.
 *
 * Usage:
 *   node scripts/generate-update-json.js
 *
 * Output:
 *   update.json (in working directory)
 */

const fs = require("fs");
const path = require("path");

// ── Platform artifact filename patterns ──────────────────────────────────

const PLATFORM_MAP = [
  {
    platform: "darwin-aarch64",
    // macOS ARM64: DMG file
    glob: /MiniMax Monitor_.*_aarch64\.dmg$/,
    extractVersion: (fileName) => {
      const m = fileName.match(/MiniMax Monitor_(.+)_aarch64\.dmg$/);
      return m ? m[1] : null;
    },
  },
  {
    platform: "darwin-x86_64",
    // macOS x64: DMG file
    glob: /MiniMax Monitor_.*_x64\.dmg$/,
    extractVersion: (fileName) => {
      const m = fileName.match(/MiniMax Monitor_(.+)_x64\.dmg$/);
      return m ? m[1] : null;
    },
  },
  {
    platform: "linux-x86_64",
    // Linux: AppImage
    glob: /MiniMax Monitor_.*_amd64\.AppImage$/,
    extractVersion: (fileName) => {
      const m = fileName.match(/MiniMax Monitor_(.+)_amd64\.AppImage$/);
      return m ? m[1] : null;
    },
  },
  {
    platform: "windows-x86_64",
    // Windows: NSIS installer
    glob: /MiniMax Monitor_.*_x64-setup\.exe$/,
    extractVersion: (fileName) => {
      const m = fileName.match(/MiniMax Monitor_(.+)_x64-setup\.exe$/);
      return m ? m[1] : null;
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function getVersion() {
  const tag = process.env.GITHUB_REF_NAME || "";
  return tag.replace(/^v/, "");
}

function getRepo() {
  return process.env.GITHUB_REPOSITORY || "nextransit/minimax-usage-plugin";
}

function getTag() {
  return process.env.GITHUB_REF_NAME || "";
}

/**
 * Walk the artifacts directory and find matching files per platform.
 */
function findArtifacts(artifactsDir) {
  const results = {};

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relativePath = fullPath.replace(artifactsDir, "");
        for (const p of PLATFORM_MAP) {
          if (p.glob.test(entry.name)) {
            results[p.platform] = {
              fileName: entry.name,
              relativePath,
            };
          }
        }
      }
    }
  }

  walk(artifactsDir);
  return results;
}

/**
 * Extract release notes for current version from CHANGELOG.md.
 */
function getReleaseNotes(version) {
  const changelogPath = path.join(process.cwd(), "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) return "";

  const content = fs.readFileSync(changelogPath, "utf8");
  const lines = content.split("\n");
  const versionHeader = `## ${version}`;

  let inSection = false;
  let notes = [];

  for (const line of lines) {
    if (line.startsWith(versionHeader)) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) {
      break;
    }
    if (inSection) {
      notes.push(line);
    }
  }

  return notes.join("\n").trim();
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const version = getVersion();
  const repo = getRepo();
  const tag = getTag();
  const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;

  if (!version) {
    console.error("Error: Could not determine version from GITHUB_REF_NAME");
    process.exit(1);
  }

  console.log(`Version: ${version}`);
  console.log(`Repo: ${repo}`);
  console.log(`Tag: ${tag}`);
  console.log(`Base URL: ${baseUrl}`);

  // Find artifacts in the artifacts directory (uploaded by download-artifact action)
  const artifactsDir = path.join(process.cwd(), "artifacts");
  const found = findArtifacts(artifactsDir);

  console.log("Found artifacts:", JSON.stringify(found, null, 2));

  const platforms = {};
  for (const p of PLATFORM_MAP) {
    const artifact = found[p.platform];
    if (artifact) {
      platforms[p.platform] = {
        url: `${baseUrl}/${artifact.fileName}`,
        signature: "",
      };
      console.log(`  ${p.platform}: ${artifact.fileName}`);
    } else {
      console.warn(`  ${p.platform}: NOT FOUND`);
    }
  }

  if (Object.keys(platforms).length === 0) {
    console.error("Error: No platform artifacts found");
    process.exit(1);
  }

  const notes = getReleaseNotes(version);

  const updateJson = {
    version,
    notes: notes || `MiniMax Monitor v${version}`,
    pub_date: new Date().toISOString(),
    platforms,
  };

  const outputPath = path.join(process.cwd(), "update.json");
  fs.writeFileSync(outputPath, JSON.stringify(updateJson, null, 2) + "\n");

  console.log(`\nupdate.json written to ${outputPath}`);
  console.log(JSON.stringify(updateJson, null, 2));
}

main();
