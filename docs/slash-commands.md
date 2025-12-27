---
title: Slash Commands
description: Create custom slash commands with template variables for your AI workflows.
icon: terminal
---

Maestro includes an extensible slash command system with autocomplete. Type `/` in the input area to open the autocomplete menu, use arrow keys to navigate, and press `Tab` or `Enter` to select.

## Custom AI Commands

Create your own slash commands in **Settings > Custom AI Commands**. Each command has a trigger (e.g., `/deploy`) and a prompt that gets sent to the AI agent.

Commands support **template variables** that are automatically substituted at runtime:

### Agent Variables

| Variable | Description |
|----------|-------------|
| `{{AGENT_NAME}}` | Agent name |
| `{{AGENT_PATH}}` | Agent home directory path (full path to project) |
| `{{AGENT_GROUP}}` | Agent's group name (if grouped) |
| `{{AGENT_SESSION_ID}}` | Agent session ID (for conversation continuity) |
| `{{TAB_NAME}}` | Custom tab name (alias: `SESSION_NAME`) |
| `{{TOOL_TYPE}}` | Agent type (claude-code, codex, opencode) |

### Path Variables

| Variable | Description |
|----------|-------------|
| `{{CWD}}` | Current working directory |
| `{{AUTORUN_FOLDER}}` | Auto Run documents folder path |

### Auto Run Variables

| Variable | Description |
|----------|-------------|
| `{{DOCUMENT_NAME}}` | Current Auto Run document name (without .md) |
| `{{DOCUMENT_PATH}}` | Full path to current Auto Run document |
| `{{LOOP_NUMBER}}` | Current loop iteration (starts at 1) |

### Date/Time Variables

| Variable | Description |
|----------|-------------|
| `{{DATE}}` | Current date (YYYY-MM-DD) |
| `{{TIME}}` | Current time (HH:MM:SS) |
| `{{DATETIME}}` | Full datetime (YYYY-MM-DD HH:MM:SS) |
| `{{TIMESTAMP}}` | Unix timestamp in milliseconds |
| `{{DATE_SHORT}}` | Short date (MM/DD/YY) |
| `{{TIME_SHORT}}` | Short time (HH:MM) |
| `{{YEAR}}` | Current year (YYYY) |
| `{{MONTH}}` | Current month (01-12) |
| `{{DAY}}` | Current day (01-31) |
| `{{WEEKDAY}}` | Day of week (Monday, Tuesday, etc.) |

### Git & Context Variables

| Variable | Description |
|----------|-------------|
| `{{GIT_BRANCH}}` | Current git branch name (requires git repo) |
| `{{IS_GIT_REPO}}` | "true" or "false" |
| `{{CONTEXT_USAGE}}` | Current context window usage percentage |

**Example**: A custom `/standup` command with prompt:

```
It's {{WEEKDAY}}, {{DATE}}. I'm on branch {{GIT_BRANCH}} at {{AGENT_PATH}}.
Summarize what I worked on yesterday and suggest priorities for today.
```
