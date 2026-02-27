#!/usr/bin/env node
/**
 * claude-export installer
 *
 * Copies slash commands and scripts into the current project so Claude Code
 * can use /export and /export-continue.
 *
 * Usage:
 *   node install.js           # install into current project
 *   npx claude-export         # same, via npm
 */

const fs = require("fs");
const path = require("path");

const SRC_DIR = __dirname;
const TARGET_DIR = process.cwd();

const FILES = [
  { src: "scripts/export-chat.js", dst: "scripts/export-chat.js" },
  { src: "scripts/export-continue.js", dst: "scripts/export-continue.js" },
  { src: "commands/export.md", dst: ".claude/commands/export.md" },
  { src: "commands/export-continue.md", dst: ".claude/commands/export-continue.md" },
];

function install() {
  console.log("\n  claude-export installer");
  console.log("  ======================\n");
  console.log(`  Installing into: ${TARGET_DIR}\n`);

  let installed = 0;
  let skipped = 0;

  for (const file of FILES) {
    const srcPath = path.join(SRC_DIR, file.src);
    const dstPath = path.join(TARGET_DIR, file.dst);
    const dstDir = path.dirname(dstPath);

    // Create directories if needed
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }

    // Check if target already exists
    if (fs.existsSync(dstPath)) {
      const srcContent = fs.readFileSync(srcPath, "utf8");
      const dstContent = fs.readFileSync(dstPath, "utf8");
      if (srcContent === dstContent) {
        console.log(`  [=] ${file.dst} (already up to date)`);
        skipped++;
        continue;
      }
      // Backup existing file
      const backupPath = dstPath + ".backup";
      fs.copyFileSync(dstPath, backupPath);
      console.log(`  [~] ${file.dst} (updated, backup at ${file.dst}.backup)`);
    } else {
      console.log(`  [+] ${file.dst}`);
    }

    fs.copyFileSync(srcPath, dstPath);
    installed++;
  }

  console.log(`\n  Done! ${installed} installed, ${skipped} already up to date.\n`);

  if (installed > 0) {
    console.log("  Usage:");
    console.log("    /export           - Full Markdown transcript (for AI review)");
    console.log("    /export-continue  - Compact JSON handoff (for AI continuation)");
    console.log("");
    console.log("  Both commands auto-detect your project. No configuration needed.");
    console.log("");
  }
}

install();
