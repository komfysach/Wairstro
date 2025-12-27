---
title: Context Management
description: Compact, merge, and transfer conversation context between sessions and agents.
icon: layers
---

Context management lets you combine or transfer conversation history between sessions and agents, enabling powerful workflows where you can:

- **Compact & continue** — Compress your context to stay within token limits while preserving key information
- **Merge sessions** — Combine context from multiple conversations into one
- **Transfer to other agents** — Send your context to a different AI agent (e.g., Claude Code → Codex)

## Compact & Continue

When your conversation approaches context limits, you can compress it while preserving essential information:

1. **Right-click** a tab → **"Context: Compact"**, or use **Command Palette** (`Cmd+K` / `Ctrl+K`) → "Context: Compact"
2. The AI compacts the conversation, extracting key decisions, code changes, and context
3. A new tab opens with the compressed context, ready to continue working

**When to use:**
- The context warning sash appears (yellow at 60%, red at 80% usage)
- You want to continue a long conversation without losing important context
- You need to free up context space for new tasks

**What gets preserved:**
- Key decisions and their rationale
- Code changes and file modifications
- Important technical details and constraints
- Current task state and next steps

## Merging Sessions

Combine context from multiple sessions or tabs into one:

1. **Right-click** a tab → **"Merge With..."**, or use **Command Palette** (`Cmd+K` / `Ctrl+K`) → "Merge with another session"
2. Search for or select the target session/tab
3. Review the merge preview showing estimated token count
4. Click **"Merge Contexts"**

The merged context creates a new tab in the target session with conversation history from both sources. Use this to consolidate related conversations or bring context from an older session into a current one.

**What gets merged:**
- Full conversation history (user messages and AI responses)
- Token estimates are shown before merge to help you stay within context limits

**Tips:**
- You can merge tabs within the same session or across different sessions
- Large merges (100k+ tokens) will show a warning but still proceed
- Self-merge (same tab to itself) is prevented

## Sending to Another Agent

Transfer your context to a different AI agent:

1. **Right-click** a tab → **"Send to Agent..."**, or use **Command Palette** (`Cmd+K` / `Ctrl+K`) → "Send to another agent"
2. Select the target agent (only available/installed agents are shown)
3. Optionally enable **context grooming** to optimize the context for the target agent
4. A new session opens with the transferred context

**Context Grooming:**
When transferring between different agent types, the context can be automatically "groomed" to:
- Remove agent-specific artifacts and formatting
- Condense verbose output while preserving key information
- Optimize for the target agent's capabilities

Grooming is enabled by default but can be skipped for faster transfers.

**Use Cases:**
- Start a task in Claude Code, then hand off to Codex for a different perspective
- Transfer a debugging session to an agent with different tool access
- Move context to an agent pointing at a different project directory
