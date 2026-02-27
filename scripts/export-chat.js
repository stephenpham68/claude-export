#!/usr/bin/env node
/**
 * Claude Code Conversation Export -> Markdown (AI-optimized)
 *
 * Produces a detailed, structured export designed for AI agents to read,
 * review progress, and recommend solutions without needing manual context.
 *
 * Works with ANY Claude Code project - auto-detects project directory.
 *
 * Usage:
 *   node scripts/export-chat.js                 # export latest session
 *   node scripts/export-chat.js <session-id>    # export specific session
 *   node scripts/export-chat.js --list          # list recent sessions
 *   node scripts/export-chat.js --no-thinking   # exclude thinking blocks
 *   node scripts/export-chat.js --no-results    # exclude tool results (compact)
 *   node scripts/export-chat.js --output <dir>  # output to specific directory
 *   node scripts/export-chat.js --max-result-lines 200  # limit result lines (default: 150)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ── Auto-detection ──────────────────────────────────────────────────

/**
 * Encode a filesystem path the same way Claude Code does internally.
 * e.g. "c:\Users\ADMIN\project" -> "c--Users-ADMIN-project"
 *      "/home/user/project"     -> "-home-user-project"
 */
function encodeProjectPath(absPath) {
  // Normalize to forward slashes
  let p = absPath.replace(/\\/g, "/");
  // Remove trailing slash
  p = p.replace(/\/$/, "");
  // Replace : and / with -
  p = p.replace(/[:/]/g, "-");
  return p;
}

/**
 * Find the Claude Code project directory for the current working directory.
 * Searches ~/.claude/projects/ for a matching encoded path.
 */
function findClaudeProjectDir(cwd) {
  const claudeProjectsRoot = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeProjectsRoot)) {
    console.error("Claude Code projects directory not found: " + claudeProjectsRoot);
    console.error("Make sure Claude Code has been used in this project at least once.");
    process.exit(1);
  }

  const encoded = encodeProjectPath(cwd);

  // Try exact match first
  const exactPath = path.join(claudeProjectsRoot, encoded);
  if (fs.existsSync(exactPath)) return exactPath;

  // Try case-insensitive match (Windows drives can be C or c)
  const dirs = fs.readdirSync(claudeProjectsRoot);
  const match = dirs.find((d) => d.toLowerCase() === encoded.toLowerCase());
  if (match) return path.join(claudeProjectsRoot, match);

  // Try partial match (user might be in a subdirectory)
  const parentMatch = dirs
    .filter((d) => encoded.toLowerCase().startsWith(d.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0]; // longest match wins
  if (parentMatch) return path.join(claudeProjectsRoot, parentMatch);

  console.error("No Claude Code session data found for: " + cwd);
  console.error("Encoded path tried: " + encoded);
  console.error("Available projects:");
  dirs.slice(0, 10).forEach((d) => console.error("  " + d));
  process.exit(1);
}

/**
 * Detect the project name from the current directory.
 * Priority: package.json name -> git remote name -> folder name
 */
function detectProjectName(projectRoot) {
  // Try package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    if (pkg.name) return pkg.name.replace(/^@[^/]+\//, ""); // strip scope
  } catch {}

  // Try git remote
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: projectRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  } catch {}

  // Fallback: folder name
  return path.basename(projectRoot);
}

// ── Config ──────────────────────────────────────────────────────────
const PROJECT_ROOT = process.cwd();
const CLAUDE_PROJECT_DIR = findClaudeProjectDir(PROJECT_ROOT);
const PROJECT_NAME = detectProjectName(PROJECT_ROOT);
const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");

const DEFAULT_MAX_RESULT_LINES = 150;
const MAX_WRITE_CONTENT_LINES = 300;
const MAX_THINKING_CHARS = 2000;

// ── CLI Args ────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    list: false,
    sessionId: null,
    includeThinking: true,
    includeResults: true,
    maxResultLines: DEFAULT_MAX_RESULT_LINES,
    outputDir: DOWNLOADS_DIR,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--list" || args[i] === "-l") opts.list = true;
    else if (args[i] === "--no-thinking") opts.includeThinking = false;
    else if (args[i] === "--no-results") opts.includeResults = false;
    else if (args[i] === "--max-result-lines" && args[i + 1]) {
      opts.maxResultLines = parseInt(args[++i], 10) || DEFAULT_MAX_RESULT_LINES;
    } else if ((args[i] === "--output" || args[i] === "-o") && args[i + 1]) {
      opts.outputDir = path.resolve(args[++i]);
    } else if (args[i].startsWith("-")) {
      /* ignore unknown flags */
    } else {
      opts.sessionId = args[i];
    }
  }
  return opts;
}

// ── List Sessions ───────────────────────────────────────────────────
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

// ── Parse ───────────────────────────────────────────────────────────
function parseJsonl(filePath) {
  const data = fs.readFileSync(filePath, "utf8");
  return data
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
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

function formatTimestamp(ts) {
  if (!ts) return "";
  return new Date(ts).toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

function truncateLines(text, maxLines) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const kept = lines.slice(0, maxLines);
  const dropped = lines.length - maxLines;
  kept.push(`\n... (${dropped} more lines truncated, total ${lines.length} lines)`);
  return kept.join("\n");
}

function truncateChars(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + `\n... (truncated at ${maxChars} chars, total ${text.length})`;
}

function shortPath(fp) {
  // Strip the project root prefix to get relative path
  const normalized = (fp || "").replace(/\\/g, "/");
  const rootNormalized = PROJECT_ROOT.replace(/\\/g, "/");
  if (normalized.startsWith(rootNormalized)) {
    return normalized.substring(rootNormalized.length + 1);
  }
  // Fallback: strip everything before project name
  const projIdx = normalized.lastIndexOf(PROJECT_NAME);
  if (projIdx >= 0) {
    return normalized.substring(projIdx + PROJECT_NAME.length + 1);
  }
  return normalized;
}

function getFileExt(filePath) {
  return (filePath || "").split(".").pop() || "text";
}

function getGitContext() {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const log = execSync('git log --oneline -5 --format="%h %s"', {
      cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { branch, recentCommits: log };
  } catch {
    return { branch: "unknown", recentCommits: "" };
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

// ── Collect stats ───────────────────────────────────────────────────
function collectStats(entries, toolResultMap) {
  const stats = {
    userTurns: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolErrors: 0,
    thinkingBlocks: 0,
    toolBreakdown: {},
    filesRead: new Set(),
    filesWritten: new Set(),
    filesEdited: new Set(),
    bashCommands: 0,
    searches: 0,
    duration: { start: null, end: null },
  };

  for (const entry of entries) {
    const ts = entry.timestamp;
    if (ts) {
      if (!stats.duration.start) stats.duration.start = ts;
      stats.duration.end = ts;
    }

    if (entry.type === "user") {
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      const hasToolResult = content.some((c) => c.type === "tool_result");
      if (!hasToolResult) stats.userTurns++;
    }

    if (entry.type === "assistant") {
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;

      const hasText = content.some((c) => c.type === "text");
      if (hasText) stats.assistantMessages++;

      for (const block of content) {
        if (block.type === "thinking") stats.thinkingBlocks++;
        if (block.type === "tool_use") {
          stats.toolCalls++;
          const name = block.name || "Unknown";
          stats.toolBreakdown[name] = (stats.toolBreakdown[name] || 0) + 1;

          const result = toolResultMap[block.id];
          if (result?.is_error) stats.toolErrors++;

          const input = block.input || {};
          if (name === "Read" && input.file_path) stats.filesRead.add(shortPath(input.file_path));
          if (name === "Write" && input.file_path) stats.filesWritten.add(shortPath(input.file_path));
          if (name === "Edit" && input.file_path) stats.filesEdited.add(shortPath(input.file_path));
          if (name === "Bash") stats.bashCommands++;
          if (name === "Grep" || name === "Glob") stats.searches++;
        }
      }
    }
  }

  return stats;
}

// ── Format tool call with result ────────────────────────────────────
function formatToolCall(block, toolResultMap, opts) {
  const parts = [];
  const toolName = block.name || "Unknown";
  const input = block.input || {};
  const result = toolResultMap[block.id];
  const isError = result?.is_error || false;

  const header = isError ? `### [ERROR] Tool: ${toolName}` : `### Tool: ${toolName}`;
  parts.push(header);
  parts.push("");

  if (toolName === "Bash") {
    if (input.description) parts.push(`> ${input.description}`);
    parts.push("**Command:**");
    parts.push("```bash");
    parts.push(input.command || "");
    parts.push("```");
  } else if (toolName === "Read") {
    parts.push(`**File:** \`${shortPath(input.file_path)}\``);
    if (input.offset) parts.push(`**Offset:** line ${input.offset}`);
    if (input.limit) parts.push(`**Limit:** ${input.limit} lines`);
  } else if (toolName === "Write") {
    parts.push(`**File:** \`${shortPath(input.file_path)}\``);
    if (input.content) {
      const ext = getFileExt(input.file_path);
      const truncated = truncateLines(input.content, MAX_WRITE_CONTENT_LINES);
      parts.push("**Content written:**");
      parts.push("```" + ext);
      parts.push(truncated);
      parts.push("```");
    }
  } else if (toolName === "Edit") {
    parts.push(`**File:** \`${shortPath(input.file_path)}\``);
    if (input.replace_all) parts.push("**Mode:** replace_all");
    if (input.old_string !== undefined) {
      parts.push("**Old:**");
      parts.push("```");
      parts.push(input.old_string);
      parts.push("```");
    }
    if (input.new_string !== undefined) {
      parts.push("**New:**");
      parts.push("```");
      parts.push(input.new_string);
      parts.push("```");
    }
  } else if (toolName === "Grep") {
    parts.push(`**Pattern:** \`${input.pattern || ""}\``);
    if (input.path) parts.push(`**Path:** \`${shortPath(input.path)}\``);
    if (input.glob) parts.push(`**Glob:** \`${input.glob}\``);
    if (input.output_mode) parts.push(`**Mode:** ${input.output_mode}`);
  } else if (toolName === "Glob") {
    parts.push(`**Pattern:** \`${input.pattern || ""}\``);
    if (input.path) parts.push(`**Path:** \`${shortPath(input.path)}\``);
  } else if (toolName === "Task") {
    parts.push(`**Agent:** ${input.subagent_type || "?"}`);
    if (input.description) parts.push(`**Description:** ${input.description}`);
    if (input.model) parts.push(`**Model:** ${input.model}`);
    parts.push("**Prompt:**");
    parts.push("```");
    parts.push(truncateChars(input.prompt || "", 3000));
    parts.push("```");
  } else if (toolName === "WebSearch") {
    parts.push(`**Query:** \`${input.query || ""}\``);
  } else if (toolName === "WebFetch") {
    parts.push(`**URL:** ${input.url || ""}`);
    if (input.prompt) parts.push(`**Prompt:** ${input.prompt}`);
  } else if (toolName === "TodoWrite") {
    parts.push("**Tasks:**");
    const todos = input.todos || [];
    for (const t of todos) {
      const icon = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
      parts.push(`- ${icon} ${t.content}`);
    }
  } else if (toolName === "NotebookEdit") {
    parts.push(`**Notebook:** \`${shortPath(input.notebook_path)}\``);
    if (input.cell_type) parts.push(`**Cell type:** ${input.cell_type}`);
    if (input.edit_mode) parts.push(`**Edit mode:** ${input.edit_mode}`);
    if (input.new_source) {
      parts.push("**Source:**");
      parts.push("```");
      parts.push(truncateLines(input.new_source, 100));
      parts.push("```");
    }
  } else if (toolName === "AskUserQuestion") {
    const qs = input.questions || [];
    for (const q of qs) {
      parts.push(`**Q:** ${q.question}`);
      if (q.options) {
        for (const o of q.options) {
          parts.push(`  - ${o.label}: ${o.description || ""}`);
        }
      }
    }
  } else {
    const summary = JSON.stringify(input, null, 2);
    parts.push("**Input:**");
    parts.push("```json");
    parts.push(truncateChars(summary, 2000));
    parts.push("```");
  }

  // Result
  if (opts.includeResults && result) {
    parts.push("");
    if (isError) {
      parts.push("**Result: ERROR**");
      parts.push("```");
      parts.push(truncateLines(result.content || "(empty)", opts.maxResultLines));
      parts.push("```");
    } else {
      const resultContent = result.content || "";
      if (resultContent.trim()) {
        const isFileContent = resultContent.match(/^\s+\d+→/m);
        const ext = toolName === "Read" && input.file_path ? getFileExt(input.file_path) : "";
        parts.push("**Result:**");
        if (isFileContent && ext) {
          parts.push("```" + ext);
        } else {
          parts.push("```");
        }
        parts.push(truncateLines(resultContent, opts.maxResultLines));
        parts.push("```");
      }
    }
  }

  return parts.join("\n");
}

// ── Main converter ──────────────────────────────────────────────────
function convertToMarkdown(entries, sessionId, opts) {
  const parts = [];
  const toolResultMap = buildToolResultMap(entries);
  const stats = collectStats(entries, toolResultMap);
  const git = getGitContext();

  // Header
  parts.push("# Claude Code Conversation Export");
  parts.push("");
  parts.push("> **Purpose:** This export is structured for AI agents to read, review progress,");
  parts.push("> identify issues, and recommend next steps. Includes full tool inputs/outputs.");
  parts.push("");
  parts.push("## Metadata");
  parts.push("");
  parts.push("| Field | Value |");
  parts.push("|-------|-------|");
  parts.push(`| Session ID | \`${sessionId}\` |`);
  parts.push(`| Project | ${PROJECT_NAME} |`);
  parts.push(`| Branch | \`${git.branch}\` |`);
  parts.push(`| Start | ${formatTimestamp(stats.duration.start)} |`);
  parts.push(`| End | ${formatTimestamp(stats.duration.end)} |`);
  if (stats.duration.start && stats.duration.end) {
    const durationMs = new Date(stats.duration.end) - new Date(stats.duration.start);
    const mins = Math.round(durationMs / 60000);
    parts.push(`| Duration | ~${mins} min |`);
  }
  parts.push("");

  // Summary
  parts.push("## Session Summary");
  parts.push("");
  parts.push(`- **${stats.userTurns}** user turns, **${stats.assistantMessages}** assistant responses`);
  parts.push(`- **${stats.toolCalls}** tool calls (${stats.toolErrors} errors)`);
  if (stats.thinkingBlocks > 0) {
    parts.push(`- **${stats.thinkingBlocks}** thinking/reasoning blocks`);
  }
  parts.push("");

  const toolNames = Object.keys(stats.toolBreakdown).sort(
    (a, b) => stats.toolBreakdown[b] - stats.toolBreakdown[a]
  );
  if (toolNames.length > 0) {
    parts.push("**Tool usage breakdown:**");
    for (const name of toolNames) {
      parts.push(`- ${name}: ${stats.toolBreakdown[name]}x`);
    }
    parts.push("");
  }

  const allFilesWritten = new Set([...stats.filesWritten, ...stats.filesEdited]);
  if (stats.filesRead.size > 0 || allFilesWritten.size > 0) {
    parts.push("**Files touched:**");
    if (allFilesWritten.size > 0) {
      parts.push(`- Modified/Created (${allFilesWritten.size}):`);
      for (const f of allFilesWritten) parts.push(`  - \`${f}\``);
    }
    if (stats.filesRead.size > 0) {
      parts.push(`- Read (${stats.filesRead.size}):`);
      for (const f of stats.filesRead) parts.push(`  - \`${f}\``);
    }
    parts.push("");
  }

  if (git.recentCommits) {
    parts.push("**Recent commits (context):**");
    parts.push("```");
    parts.push(git.recentCommits);
    parts.push("```");
    parts.push("");
  }

  parts.push("---");
  parts.push("");

  // Conversation
  parts.push("## Conversation");
  parts.push("");

  let turnCount = 0;

  for (const entry of entries) {
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const msg = entry.message;
    if (!msg || !msg.content) continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    const role = msg.role;
    const time = formatTimestamp(entry.timestamp);

    if (role === "user") {
      const isToolResult = content.some((c) => c.type === "tool_result");
      if (isToolResult) continue;
      turnCount++;
      parts.push(`### User (Turn ${turnCount})`);
      if (time) parts.push(`*${time}*`);
      parts.push("");
      for (const block of content) {
        if (block.type === "text") {
          const cleaned = stripSystemTags(block.text);
          if (cleaned) { parts.push(cleaned); parts.push(""); }
        } else if (block.type === "image") {
          parts.push("*[Image attached]*"); parts.push("");
        }
      }
      parts.push("---"); parts.push("");
    } else if (role === "assistant") {
      let hasContent = false;
      for (const block of content) {
        if (block.type === "thinking" && opts.includeThinking) {
          if (!hasContent) { parts.push("### Assistant"); if (time) parts.push(`*${time}*`); parts.push(""); hasContent = true; }
          const thinking = block.thinking || "";
          if (thinking.trim()) {
            parts.push("<details>"); parts.push("<summary>Thinking / Internal Reasoning</summary>");
            parts.push(""); parts.push(truncateChars(thinking, MAX_THINKING_CHARS));
            parts.push(""); parts.push("</details>"); parts.push("");
          }
        } else if (block.type === "text") {
          if (!hasContent) { parts.push("### Assistant"); if (time) parts.push(`*${time}*`); parts.push(""); hasContent = true; }
          parts.push(block.text); parts.push("");
        } else if (block.type === "tool_use") {
          if (!hasContent) { parts.push("### Assistant"); if (time) parts.push(`*${time}*`); parts.push(""); hasContent = true; }
          parts.push(formatToolCall(block, toolResultMap, opts)); parts.push("");
        }
      }
      if (hasContent) { parts.push("---"); parts.push(""); }
    }
  }

  // Footer
  parts.push("");
  parts.push("---");
  parts.push(`*Exported at ${formatTimestamp(new Date().toISOString())}*`);
  parts.push(`*Export version: 2.0 (AI-optimized with tool results)*`);
  parts.push(`*Tool: claude-export (https://github.com/stephenpham68/claude-export)*`);

  return parts.join("\n");
}

// ── Active session detection ─────────────────────────────────────────
/**
 * Read the last entry's timestamp from a JSONL file.
 * More reliable than file mtime for detecting the actively-running session,
 * because when /export runs, the current session just wrote a tool_use entry.
 */
function getLastEntryTimestamp(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const readSize = Math.min(stat.size, 16384); // last 16KB
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
    return stat.mtime.getTime(); // fallback
  } catch {
    return 0;
  }
}

// ── Entry point ─────────────────────────────────────────────────────
function main() {
  const opts = parseArgs();

  if (opts.list) {
    listSessions();
    return;
  }

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
    // Sort by last entry timestamp (not file mtime) to detect the active session.
    // When /export runs, Claude Code just wrote a tool_use to the current session's
    // JSONL, so its last entry will always be the most recent.
    const files = fs
      .readdirSync(CLAUDE_PROJECT_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const fp = path.join(CLAUDE_PROJECT_DIR, f);
        return { name: f, lastEntry: getLastEntryTimestamp(fp) };
      })
      .sort((a, b) => b.lastEntry - a.lastEntry);

    if (files.length === 0) {
      console.error("No session files found.");
      process.exit(1);
    }
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
  const markdown = convertToMarkdown(entries, sessionId, opts);

  // Ensure output dir exists
  if (!fs.existsSync(opts.outputDir)) {
    fs.mkdirSync(opts.outputDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const shortId = sessionId.substring(0, 8);
  const outFile = path.join(opts.outputDir, `claude-chat_${dateStr}_${shortId}.md`);

  fs.writeFileSync(outFile, markdown, "utf8");
  const outSizeKB = Math.round(markdown.length / 1024);
  console.log(`Exported to: ${outFile}`);
  console.log(`Output size: ${outSizeKB} KB (${markdown.split("\n").length} lines)`);
}

main();
