#!/usr/bin/env node
/**
 * Export Claude Code session as a compact JSON handoff for AI agents.
 *
 * Produces a structured, token-efficient JSON file that captures:
 * - What task was requested
 * - What was done (files changed, decisions made)
 * - Current progress (todos)
 * - Errors encountered and resolutions
 * - Condensed conversation digest
 *
 * Works with ANY Claude Code project - auto-detects project directory.
 *
 * Designed for: AI agent continuation, expert AI review, cross-model handoff.
 * NOT for human reading - optimized for AI parsing.
 *
 * Usage:
 *   node scripts/export-continue.js                 # export latest session
 *   node scripts/export-continue.js <session-id>    # export specific session
 *   node scripts/export-continue.js --list          # list recent sessions
 *   node scripts/export-continue.js --output <dir>  # output to specific directory
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ── Auto-detection ──────────────────────────────────────────────────

function encodeProjectPath(absPath) {
  let p = absPath.replace(/\\/g, "/").replace(/\/$/, "");
  return p.replace(/[:/]/g, "-");
}

function findClaudeProjectDir(cwd) {
  const claudeProjectsRoot = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeProjectsRoot)) {
    console.error("Claude Code projects directory not found: " + claudeProjectsRoot);
    console.error("Make sure Claude Code has been used in this project at least once.");
    process.exit(1);
  }

  const encoded = encodeProjectPath(cwd);
  const exactPath = path.join(claudeProjectsRoot, encoded);
  if (fs.existsSync(exactPath)) return exactPath;

  const dirs = fs.readdirSync(claudeProjectsRoot);
  const match = dirs.find((d) => d.toLowerCase() === encoded.toLowerCase());
  if (match) return path.join(claudeProjectsRoot, match);

  const parentMatch = dirs
    .filter((d) => encoded.toLowerCase().startsWith(d.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  if (parentMatch) return path.join(claudeProjectsRoot, parentMatch);

  console.error("No Claude Code session data found for: " + cwd);
  console.error("Encoded path tried: " + encoded);
  console.error("Available projects:");
  dirs.slice(0, 10).forEach((d) => console.error("  " + d));
  process.exit(1);
}

function detectProjectName(projectRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    if (pkg.name) return pkg.name.replace(/^@[^/]+\//, "");
  } catch {}
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: projectRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  } catch {}
  return path.basename(projectRoot);
}

// ── Config ──────────────────────────────────────────────────────────
const PROJECT_ROOT = process.cwd();
const CLAUDE_PROJECT_DIR = findClaudeProjectDir(PROJECT_ROOT);
const PROJECT_NAME = detectProjectName(PROJECT_ROOT);
const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");

// ── CLI ─────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { list: false, sessionId: null, outputDir: DOWNLOADS_DIR };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--list" || args[i] === "-l") opts.list = true;
    else if ((args[i] === "--output" || args[i] === "-o") && args[i + 1]) {
      opts.outputDir = path.resolve(args[++i]);
    } else if (!args[i].startsWith("-")) opts.sessionId = args[i];
  }
  return opts;
}

// ── Parse JSONL ─────────────────────────────────────────────────────
function parseJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

// ── Helpers ─────────────────────────────────────────────────────────
function stripSystemTags(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "")
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, "")
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .trim();
}

function shortPath(fp) {
  const normalized = (fp || "").replace(/\\/g, "/");
  const rootNormalized = PROJECT_ROOT.replace(/\\/g, "/");
  if (normalized.startsWith(rootNormalized)) {
    return normalized.substring(rootNormalized.length + 1);
  }
  const projIdx = normalized.lastIndexOf(PROJECT_NAME);
  if (projIdx >= 0) return normalized.substring(projIdx + PROJECT_NAME.length + 1);
  return normalized;
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || "";
  return text.substring(0, max) + "...";
}

function getGitContext() {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const log = execSync('git log --oneline -5 --format="%h %s"', {
      cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const status = execSync("git diff --name-only HEAD", {
      cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return {
      branch,
      recent_commits: log.split("\n").filter(Boolean),
      uncommitted_files: status.split("\n").filter(Boolean).map(shortPath),
    };
  } catch {
    return { branch: "unknown", recent_commits: [], uncommitted_files: [] };
  }
}

// ── Build tool result map ───────────────────────────────────────────
function buildToolResultMap(entries) {
  const map = {};
  for (const entry of entries) {
    if (entry.type !== "user") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_result" && block.tool_use_id) {
        map[block.tool_use_id] = {
          content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
          is_error: block.is_error || false,
        };
      }
    }
  }
  return map;
}

// ── Extract structured data ─────────────────────────────────────────
function extractHandoff(entries, sessionId) {
  const toolResultMap = buildToolResultMap(entries);
  const git = getGitContext();

  let startTs = null, endTs = null;
  for (const e of entries) {
    if (e.timestamp) {
      if (!startTs) startTs = e.timestamp;
      endTs = e.timestamp;
    }
  }
  const durationMin = startTs && endTs
    ? Math.round((new Date(endTs) - new Date(startTs)) / 60000) : 0;

  const userMessages = [];
  const fileChanges = {};
  const filesRead = new Set();
  const errors = [];
  const actions = [];
  const searches = [];
  let latestTodos = null;
  let toolCallCount = 0;

  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    if (entry.type === "user" && entry.message?.role === "user") {
      const isToolResult = content.some((c) => c.type === "tool_result");
      if (isToolResult) continue;
      for (const block of content) {
        if (block.type === "text") {
          const cleaned = stripSystemTags(block.text);
          if (cleaned) userMessages.push(truncate(cleaned, 500));
        }
      }
    }

    if (entry.type === "assistant" && entry.message?.role === "assistant") {
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        toolCallCount++;

        const name = block.name;
        const input = block.input || {};
        const result = toolResultMap[block.id];
        const isError = result?.is_error || false;

        if (isError) {
          errors.push({
            tool: name,
            error: truncate(result.content, 300),
            input_summary: name === "Bash"
              ? truncate(input.command, 200)
              : name === "Read" || name === "Write" || name === "Edit"
                ? shortPath(input.file_path)
                : truncate(JSON.stringify(input), 200),
          });
        }

        if (name === "Write" && input.file_path) {
          const sp = shortPath(input.file_path);
          fileChanges[sp] = {
            action: "created",
            summary: input.content
              ? `${input.content.split("\n").length} lines written`
              : "file created",
          };
        } else if (name === "Edit" && input.file_path) {
          const sp = shortPath(input.file_path);
          if (!fileChanges[sp]) fileChanges[sp] = { action: "modified", edits: [] };
          else fileChanges[sp].action = "modified";
          if (input.old_string !== undefined && input.new_string !== undefined) {
            if (!fileChanges[sp].edits) fileChanges[sp].edits = [];
            fileChanges[sp].edits.push({
              removed: truncate(input.old_string, 200),
              added: truncate(input.new_string, 200),
              replace_all: input.replace_all || false,
            });
          }
        } else if (name === "Read" && input.file_path) {
          filesRead.add(shortPath(input.file_path));
        }

        if (name === "Bash" && input.command) {
          const cmd = input.command.trim();
          if (cmd.length > 5 && !cmd.startsWith("echo ")) {
            const actionEntry = { command: truncate(cmd, 300) };
            if (input.description) actionEntry.description = input.description;
            if (isError) actionEntry.failed = true;
            else if (result?.content) {
              const lines = result.content.split("\n");
              if (lines.length <= 5) actionEntry.output = result.content.trim();
              else actionEntry.output = truncate(result.content, 200);
            }
            actions.push(actionEntry);
          }
        }

        if (name === "Grep") {
          const s = { type: "grep", pattern: input.pattern };
          if (input.path) s.path = shortPath(input.path);
          if (input.glob) s.glob = input.glob;
          if (result?.content) s.matches = result.content.split("\n").filter(Boolean).length;
          searches.push(s);
        } else if (name === "Glob") {
          const s = { type: "glob", pattern: input.pattern };
          if (input.path) s.path = shortPath(input.path);
          if (result?.content) s.matches = result.content.split("\n").filter(Boolean).length;
          searches.push(s);
        }

        if (name === "TodoWrite" && input.todos) latestTodos = input.todos;

        if (name === "Task") {
          const taskEntry = {
            command: truncate(input.command || input.prompt, 300),
            agent: input.subagent_type || "unknown",
          };
          if (input.description) taskEntry.description = input.description;
          if (result?.content) taskEntry.result = truncate(result.content, 300);
          if (isError) taskEntry.failed = true;
          actions.push(taskEntry);
        }
      }
    }
  }

  // Conversation digest
  const digest = [];
  let turnNum = 0;
  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    if (entry.type === "user" && entry.message?.role === "user") {
      const isToolResult = content.some((c) => c.type === "tool_result");
      if (isToolResult) continue;
      turnNum++;
      let text = "";
      for (const block of content) {
        if (block.type === "text") {
          const cleaned = stripSystemTags(block.text);
          if (cleaned) text += (text ? " " : "") + cleaned;
        }
      }
      if (text) digest.push({ turn: turnNum, role: "user", content: truncate(text, 300) });
    }

    if (entry.type === "assistant" && entry.message?.role === "assistant") {
      let text = "";
      for (const block of content) {
        if (block.type === "text" && block.text?.trim()) {
          text += (text ? " " : "") + block.text.trim();
        }
      }
      if (text) digest.push({ turn: turnNum, role: "assistant", content: truncate(text, 300) });
    }
  }

  // Progress from todos
  const progress = { completed: [], in_progress: [], pending: [] };
  if (latestTodos) {
    for (const t of latestTodos) {
      if (t.status === "completed") progress.completed.push(t.content);
      else if (t.status === "in_progress") progress.in_progress.push(t.content);
      else progress.pending.push(t.content);
    }
  }

  // Deduplicate searches
  const uniqueSearches = [];
  const seenPatterns = {};
  for (const s of searches) {
    const key = s.type + ":" + s.pattern;
    if (!seenPatterns[key]) { seenPatterns[key] = true; uniqueSearches.push(s); }
  }

  // Assemble
  const handoff = {
    _format: "claude-code-handoff",
    _version: "1.0",
    _purpose: "Structured session export for AI agent continuation. Read this to understand what was done, what changed, and what remains.",
    _tool: "claude-export (https://github.com/stephenpham68/claude-export)",

    session: {
      id: sessionId,
      project: PROJECT_NAME,
      branch: git.branch,
      started: startTs,
      ended: endTs,
      duration_minutes: durationMin,
      tool_calls: toolCallCount,
      error_count: errors.length,
    },

    task: userMessages[0] || "(no task detected)",
    progress,

    changes: Object.entries(fileChanges).map(([file, info]) => {
      const entry = { file, action: info.action };
      if (info.summary) entry.summary = info.summary;
      if (info.edits && info.edits.length > 0) entry.edits = info.edits;
      return entry;
    }),

    files_read: [...filesRead],
    errors: errors.length > 0 ? errors : undefined,
    actions: actions.length > 0 ? actions : undefined,

    searches: uniqueSearches.length > 0
      ? { count: searches.length, unique_patterns: uniqueSearches }
      : undefined,

    conversation_digest: digest,

    git_context: {
      branch: git.branch,
      recent_commits: git.recent_commits,
      uncommitted_changes: git.uncommitted_files.length > 0
        ? git.uncommitted_files.slice(0, 20) : undefined,
    },
  };

  return JSON.parse(JSON.stringify(handoff));
}

// ── List sessions ───────────────────────────────────────────────────
function listSessions(count = 15) {
  const files = fs
    .readdirSync(CLAUDE_PROJECT_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const fp = path.join(CLAUDE_PROJECT_DIR, f);
      const stat = fs.statSync(fp);
      const sessionId = f.replace(".jsonl", "");
      let preview = "";
      const data = fs.readFileSync(fp, "utf8");
      for (const line of data.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "user" && obj.message?.role === "user") {
            const content = obj.message.content;
            if (Array.isArray(content)) {
              const textBlock = content.find(
                (c) => c.type === "text" && !c.text?.startsWith("<")
              );
              if (textBlock) {
                preview = textBlock.text.substring(0, 80).replace(/\n/g, " ");
                break;
              }
            }
          }
        } catch {}
      }
      return { sessionId, mtime: stat.mtime, size: stat.size, preview };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, count);

  console.log(`\n  Project: ${PROJECT_NAME}`);
  console.log(`  Sessions dir: ${CLAUDE_PROJECT_DIR}\n`);
  for (const s of files) {
    const date = s.mtime.toISOString().replace("T", " ").substring(0, 19);
    const sizeKB = Math.round(s.size / 1024);
    console.log(`  ${s.sessionId}`);
    console.log(`    ${date} UTC | ${sizeKB} KB | ${s.preview || "(no preview)"}`);
    console.log();
  }
}

// ── Active session detection ─────────────────────────────────────────
function getLastEntryTimestamp(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const readSize = Math.min(stat.size, 16384);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n").filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.timestamp) return new Date(entry.timestamp).getTime();
      } catch {}
    }
    return stat.mtime.getTime();
  } catch {
    return 0;
  }
}

// ── Main ────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs();

  if (opts.list) { listSessions(); return; }

  let sessionId = opts.sessionId;
  let jsonlPath;

  if (sessionId) {
    if (!sessionId.endsWith(".jsonl")) {
      jsonlPath = path.join(CLAUDE_PROJECT_DIR, sessionId + ".jsonl");
    } else {
      jsonlPath = path.join(CLAUDE_PROJECT_DIR, sessionId);
      sessionId = sessionId.replace(".jsonl", "");
    }
  } else {
    const files = fs
      .readdirSync(CLAUDE_PROJECT_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const fp = path.join(CLAUDE_PROJECT_DIR, f);
        return { name: f, lastEntry: getLastEntryTimestamp(fp) };
      })
      .sort((a, b) => b.lastEntry - a.lastEntry);

    if (files.length === 0) { console.error("No session files found."); process.exit(1); }
    jsonlPath = path.join(CLAUDE_PROJECT_DIR, files[0].name);
    sessionId = files[0].name.replace(".jsonl", "");
  }

  if (!fs.existsSync(jsonlPath)) {
    console.error(`Session file not found: ${jsonlPath}`);
    process.exit(1);
  }

  const fileSize = fs.statSync(jsonlPath).size;
  console.log(`Project: ${PROJECT_NAME}`);
  console.log(`Parsing session: ${sessionId}`);
  console.log(`JSONL size: ${Math.round(fileSize / 1024)} KB`);

  const entries = parseJsonl(jsonlPath);
  const handoff = extractHandoff(entries, sessionId);
  const json = JSON.stringify(handoff, null, 2);

  if (!fs.existsSync(opts.outputDir)) {
    fs.mkdirSync(opts.outputDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const shortId = sessionId.substring(0, 8);
  const outFile = path.join(opts.outputDir, `claude-handoff_${dateStr}_${shortId}.json`);

  fs.writeFileSync(outFile, json, "utf8");
  const outSizeKB = Math.round(json.length / 1024);
  const estTokens = Math.round(json.length / 3.3);
  console.log(`Exported to: ${outFile}`);
  console.log(`Output size: ${outSizeKB} KB (~${estTokens.toLocaleString()} tokens)`);
}

main();
