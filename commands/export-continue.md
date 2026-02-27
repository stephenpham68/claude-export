---
description: Export session as compact JSON handoff for AI agent continuation
---

# Export Continue (AI Handoff)

Export the current session as a compact, structured JSON file optimized for AI agents.

Use case: Hand off work to another AI agent or send to an expert AI for review.
NOT for human reading - structured for AI parsing, token-efficient.

## Instructions

```bash
node scripts/export-continue.js
```

The file will be saved to your Downloads folder as `claude-handoff_<timestamp>_<session-id>.json`

## Options

- No arguments: exports the most recent (current) session
- `--list` or `-l`: show recent sessions to pick from
- `<session-id>`: export a specific session by its UUID
- `--output <dir>` or `-o <dir>`: save to a specific directory

## After Export

Tell the user:
1. The output file path
2. The estimated token count
3. Remind them this is for AI consumption - paste/attach it when starting a new AI chat
