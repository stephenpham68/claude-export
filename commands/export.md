---
description: Export current conversation to Markdown file (AI-optimized with full tool results)
---

# Export Conversation to Markdown

Export the current Claude Code conversation to a detailed Markdown file with full tool inputs and outputs.

## Instructions

```bash
node scripts/export-chat.js
```

The file will be saved to your Downloads folder as `claude-chat_<timestamp>_<session-id>.md`

## Options

- No arguments: exports the active (current) session
- `--list` or `-l`: show recent sessions to pick from
- `<session-id>`: export a specific session by its UUID
- `--no-thinking`: exclude thinking/reasoning blocks
- `--no-results`: exclude tool results (compact mode)
- `--output <dir>` or `-o <dir>`: save to a specific directory
- `--max-result-lines <N>`: limit tool result output (default: 150)

## After Export

Tell the user the output file path so they can find it.
