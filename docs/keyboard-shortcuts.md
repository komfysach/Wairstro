---
title: Keyboard Shortcuts
description: Complete reference for Maestro keyboard shortcuts, tab completion, and mastery tracking.
icon: keyboard
---

## Quick Actions (Cmd+K)

The command palette is your gateway to nearly every action in Maestro. Press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux) to open it.

![Command palette](./screenshots/cmd-k-1.png)

## Global Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Quick Actions | `Cmd+K` | `Ctrl+K` |
| Toggle Sidebar | `Cmd+B` | `Ctrl+B` |
| Toggle Right Panel | `Cmd+\` | `Ctrl+\` |
| New Agent | `Cmd+N` | `Ctrl+N` |
| Kill Agent | `Cmd+Shift+Backspace` | `Ctrl+Shift+Backspace` |
| Move Agent to Group | `Cmd+Shift+M` | `Ctrl+Shift+M` |
| Previous Agent | `Cmd+[` | `Ctrl+[` |
| Next Agent | `Cmd+]` | `Ctrl+]` |
| Jump to Agent (1-9, 0=10th) | `Opt+Cmd+NUMBER` | `Alt+Ctrl+NUMBER` |
| Switch AI/Command Terminal | `Cmd+J` | `Ctrl+J` |
| Show Shortcuts Help | `Cmd+/` | `Ctrl+/` |
| Open Settings | `Cmd+,` | `Ctrl+,` |
| View All Agent Sessions | `Cmd+Shift+L` | `Ctrl+Shift+L` |
| Jump to Bottom | `Cmd+Shift+J` | `Ctrl+Shift+J` |
| Cycle Focus Areas | `Tab` | `Tab` |
| Cycle Focus Backwards | `Shift+Tab` | `Shift+Tab` |

## Panel Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Go to Files Tab | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Go to History Tab | `Cmd+Shift+H` | `Ctrl+Shift+H` |
| Go to Auto Run Tab | `Cmd+Shift+1` | `Ctrl+Shift+1` |
| Toggle Markdown Raw/Preview | `Cmd+E` | `Ctrl+E` |
| Insert Checkbox (Auto Run) | `Cmd+L` | `Ctrl+L` |

## Input & Output

| Action | Key |
|--------|-----|
| Send Message | `Enter` or `Cmd+Enter` (configurable in Settings) |
| Multiline Input | `Shift+Enter` |
| Navigate Command History | `Up Arrow` while in input |
| Slash Commands | Type `/` to open autocomplete |
| Focus Output | `Esc` while in input |
| Focus Input | `Esc` while in output |
| Open Output Search | `Cmd+F` while in output |
| Scroll Output | `Up/Down Arrow` while in output |
| Page Up/Down | `Alt+Up/Down Arrow` while in output |
| Jump to Top/Bottom | `Cmd+Up/Down Arrow` while in output |

## Tab Completion (Command Terminal)

The Command Terminal provides intelligent tab completion for faster command entry:

| Action | Key |
|--------|-----|
| Open Tab Completion | `Tab` (when there's input text) |
| Navigate Suggestions | `Up/Down Arrow` |
| Select Suggestion | `Enter` |
| Cycle Filter Types | `Tab` (while dropdown is open, git repos only) |
| Cycle Filter Backwards | `Shift+Tab` (while dropdown is open) |
| Close Dropdown | `Esc` |

**Completion Sources:**
- **History** - Previous shell commands from your session
- **Files/Folders** - Files and directories in your current working directory
- **Git Branches** - Local and remote branches (git repos only)
- **Git Tags** - Available tags (git repos only)

In git repositories, filter buttons appear in the dropdown header allowing you to filter by type (All, History, Branches, Tags, Files). Use `Tab`/`Shift+Tab` to cycle through filters or click directly.

## @ File Mentions (AI Terminal)

In AI mode, use `@` to reference files in your prompts:

| Action | Key |
|--------|-----|
| Open File Picker | Type `@` followed by a search term |
| Navigate Suggestions | `Up/Down Arrow` |
| Select File | `Tab` or `Enter` |
| Close Dropdown | `Esc` |

**Example**: Type `@readme` to see matching files, then select to insert the file reference into your prompt. The AI will have context about the referenced file.

## Navigation & Search

| Action | Key |
|--------|-----|
| Navigate Agents | `Up/Down Arrow` while in sidebar |
| Select Agent | `Enter` while in sidebar |
| Open Session Filter | `Cmd+F` while in sidebar |
| Navigate Files | `Up/Down Arrow` while in file tree |
| Open File Tree Filter | `Cmd+F` while in file tree |
| Open File Preview | `Enter` on selected file |
| Close Preview/Filter/Modal | `Esc` |

## File Preview

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Copy File Path | `Cmd+P` | `Ctrl+P` |
| Open Search | `Cmd+F` | `Ctrl+F` |
| Scroll | `Up/Down Arrow` | `Up/Down Arrow` |
| Close | `Esc` | `Esc` |

*Most shortcuts are customizable in Settings > Shortcuts*

## Keyboard Mastery

Maestro tracks your keyboard shortcut usage and rewards you for becoming a power user. As you use more shortcuts, you'll level up through the mastery ranks:

| Level | Threshold | Name | Description |
|-------|-----------|------|-------------|
| 0 | 0% | **Beginner** | Just starting out |
| 1 | 25% | **Student** | Learning the basics |
| 2 | 50% | **Performer** | Getting comfortable |
| 3 | 75% | **Virtuoso** | Almost there |
| 4 | 100% | **Keyboard Maestro** | Complete mastery |

When you reach a new level, you'll see a celebration with confetti. Your progress is tracked in the Shortcuts Help modal (`Cmd+/` or `Ctrl+/`), which shows your current mastery percentage and hints at shortcuts you haven't tried yet.

**Why keyboard shortcuts matter:** Using shortcuts keeps you in flow state, reduces context switching, and dramatically speeds up your workflow. Maestro is designed for keyboard-first operation — the less you reach for the mouse, the faster you'll work.
