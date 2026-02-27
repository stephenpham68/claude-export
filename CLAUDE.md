# claude-export

Two commands for exporting Claude Code conversations:

- `/export` - Full Markdown with tool inputs/outputs (for AI review)
- `/export-continue` - Compact JSON handoff (for AI continuation)

Both auto-detect the current project. Output goes to `~/Downloads/`.

## When to use

- `/export` when user asks to export, review, or audit the conversation
- `/export-continue` when user wants to hand off work to another AI agent
