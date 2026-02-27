# claude-export

Export Claude Code conversations for AI agent handoff and review.

Two slash commands that work with **any** Claude Code project:

| Command | Output | Size | For |
|---------|--------|------|-----|
| `/export` | Detailed Markdown | ~20K tokens | AI review, debugging, audit |
| `/export-continue` | Compact JSON | ~4K tokens | AI continuation, cross-model handoff |

## Why?

Claude Code's `/compact` only works within the same session. When you need to:
- Hand off work to a **different AI agent** (GPT, Gemini, another Claude instance)
- Get an **expert AI to review** your session's progress
- **Continue work** in a new chat without re-explaining everything
- **Audit** what Claude Code actually did (every tool call + result)

These tools export your conversation in formats other AI agents can instantly understand.

## Install

### Option 1: One command (recommended)

```bash
# From your project root
npx claude-export
```

### Option 2: Manual

```bash
# Clone the repo
git clone https://github.com/stephenpham68/claude-export.git

# Run the installer from your project
cd /path/to/your-project
node /path/to/claude-export/install.js
```

### Option 3: Copy files manually

Copy these files into your project:

```
scripts/export-chat.js       -> your-project/scripts/export-chat.js
scripts/export-continue.js   -> your-project/scripts/export-continue.js
commands/export.md            -> your-project/.claude/commands/export.md
commands/export-continue.md   -> your-project/.claude/commands/export-continue.md
```

## Usage

Inside Claude Code, just type:

```
/export              # Full Markdown export
/export-continue     # Compact JSON handoff
```

Files are saved to your `~/Downloads` folder.

### CLI Options

```bash
# Export specific session
node scripts/export-chat.js <session-id>

# List recent sessions
node scripts/export-chat.js --list

# Export without thinking blocks (smaller)
node scripts/export-chat.js --no-thinking

# Export without tool results (much smaller)
node scripts/export-chat.js --no-results

# Save to custom directory
node scripts/export-chat.js --output /path/to/dir

# Limit tool result lines (default: 150)
node scripts/export-chat.js --max-result-lines 300
```

## Output Formats

### `/export` - Full Markdown

```markdown
# Claude Code Conversation Export

## Metadata
| Field | Value |
|-------|-------|
| Project | my-project |
| Branch | `feat/new-feature` |
| Duration | ~15 min |

## Session Summary
- **3** user turns, **8** assistant responses
- **42** tool calls (1 error)

## Conversation
### User (Turn 1)
Add dark mode support...

### Assistant
### Tool: Read
**File:** `src/theme.ts`
**Result:**
...full file contents...

### Tool: Edit
**File:** `src/theme.ts`
**Old:** `const theme = 'light';`
**New:** `const theme = getPreferredTheme();`

### Assistant
Done. I added dark mode support by...
```

**Includes:** Full tool inputs + outputs, thinking blocks, file contents, bash outputs, errors. Everything an AI needs to understand exactly what happened.

### `/export-continue` - Compact JSON

```json
{
  "_format": "claude-code-handoff",
  "_version": "1.0",
  "session": { "project": "my-project", "branch": "feat/new-feature", "duration_minutes": 15 },
  "task": "Add dark mode support to the application",
  "progress": {
    "completed": ["Create theme provider", "Update components"],
    "in_progress": ["Add user preference storage"],
    "pending": ["Write tests"]
  },
  "changes": [
    { "file": "src/theme.ts", "action": "modified", "edits": [...] }
  ],
  "conversation_digest": [
    { "turn": 1, "role": "user", "content": "Add dark mode..." },
    { "turn": 1, "role": "assistant", "content": "Done. Created theme provider..." }
  ]
}
```

**Includes:** Task summary, progress tracking, file changes with diffs, errors, git context. ~80% fewer tokens than the full export.

## How It Works

1. Claude Code stores session data as JSONL files in `~/.claude/projects/`
2. The scripts auto-detect your project by encoding the current working directory path
3. **Active session detection:** When no session ID is passed, the script reads the last entry's timestamp from each JSONL file (not file mtime) to find the currently-running session. This works reliably even with multiple parallel Claude Code sessions.
4. They parse the JSONL, extract structured data, and format it for AI consumption
5. No configuration needed - just run from your project root

## Requirements

- Node.js >= 16
- Claude Code (must have been used in the project at least once)
- Git (optional, for branch/commit context)

## Token Cost Comparison

For a typical 30-minute coding session:

| Format | Size | Tokens | Cost (Sonnet input) |
|--------|------|--------|-------------------|
| Raw JSONL | ~500 KB | ~150K | $0.45 |
| `/export` (Markdown) | ~70 KB | ~22K | $0.066 |
| `/export-continue` (JSON) | ~12 KB | ~4K | $0.012 |

## License

MIT
