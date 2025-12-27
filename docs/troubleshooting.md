---
title: Troubleshooting & Support
description: Debug packages, common issues, and how to get help with Maestro.
icon: life-buoy
---

## Debug Package

If you encounter deep-seated issues that are difficult to diagnose, Maestro can generate a **Debug Package** — a compressed bundle of diagnostic information that you can safely share when reporting bugs.

**To create a Debug Package:**
1. Press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux) to open Quick Actions
2. Search for "Create Debug Package"
3. Choose a save location for the `.zip` file
4. Attach the file to your [GitHub issue](https://github.com/pedramamini/Maestro/issues)

### What's Included

The debug package collects metadata and configuration — never your conversations or sensitive data:

| File | Contents |
|------|----------|
| `system-info.json` | OS, CPU, memory, Electron/Node versions, app uptime |
| `settings.json` | App preferences with sensitive values redacted |
| `agents.json` | Agent configurations, availability, and capability flags |
| `external-tools.json` | Shell, git, GitHub CLI, and cloudflared availability |
| `sessions.json` | Session metadata (names, states, tab counts — no conversations) |
| `processes.json` | Active process information |
| `logs.json` | Recent system log entries |
| `errors.json` | Current error states and recent error events |
| `storage-info.json` | Storage paths and sizes |

### Privacy Protections

The debug package is designed to be **safe to share publicly**:

- **API keys and tokens** — Replaced with `[REDACTED]`
- **Passwords and secrets** — Never included
- **Conversation content** — Excluded entirely (no AI responses, no user messages)
- **File contents** — Not included from your projects
- **Custom prompts** — Not included (may contain sensitive context)
- **File paths** — Sanitized to replace your username with `~`
- **Environment variables** — Only counts shown, not values (may contain secrets)
- **Custom agent arguments** — Only `[SET]` or `[NOT SET]` shown, not actual values

**Example path sanitization:**
- Before: `/Users/johndoe/Projects/MyApp`
- After: `~/Projects/MyApp`

## Getting Help

- **GitHub Issues**: [Report bugs or request features](https://github.com/pedramamini/Maestro/issues)
- **Discord**: [Join the community](https://discord.gg/SrBsykvG)
- **Documentation**: [Docs site](https://docs.runmaestro.ai), [CONTRIBUTING.md](https://github.com/pedramamini/Maestro/blob/main/CONTRIBUTING.md), and [ARCHITECTURE.md](https://github.com/pedramamini/Maestro/blob/main/ARCHITECTURE.md)
