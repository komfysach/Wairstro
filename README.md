# Maestro

> A unified, highly-responsive developer command center for managing your fleet of AI coding agents.

Maestro is a desktop application that allows you to run and manage multiple AI coding instances in parallel with a Linear/Superhuman-level responsive interface. Currently supporting Claude Code with plans for additional agentic coding tools (Aider, OpenCode, etc.) based on user demand.

## Installation

### Download

Download the latest release for your platform from the [Releases](https://github.com/pedramamini/maestro/releases) page:

- **macOS**: `.dmg` or `.zip`
- **Windows**: `.exe` installer
- **Linux**: `.AppImage`, `.deb`, or `.rpm`

### Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Git (optional, for git-aware features)

## Features

- 🚀 **Multi-Instance Management** - Run multiple Claude Code instances and Command Terminal sessions simultaneously
- 🔄 **Dual-Mode Input** - Switch between Command Terminal and AI Terminal seamlessly
- ⌨️ **Keyboard-First Navigation** - Full keyboard control with customizable shortcuts
- 🎨 **Beautiful Themes** - 12 themes including Dracula, Monokai, Nord, Tokyo Night, GitHub Light, and more
- 🔀 **Git Integration** - Automatic git status, diff tracking, and workspace detection
- 📁 **File Explorer** - Browse project files with syntax highlighting and markdown preview
- 📋 **Session Management** - Group, rename, and organize your sessions
- 📝 **Scratchpad** - Built-in markdown editor with live preview
- ⚡ **Slash Commands** - Extensible command system with autocomplete
- 🌐 **Remote Access** - Built-in web server with optional ngrok/Cloudflare tunneling

> **Note**: Maestro currently supports Claude Code only. Support for other agentic coding tools may be added in future releases based on community demand.

## UI Overview

Maestro features a three-panel layout:

- **Left Bar** - Session list with grouping, filtering, and organization
- **Main Window** - Center workspace with two modes:
  - **AI Terminal** - Interact with Claude Code AI assistant
  - **Command Terminal** - Execute shell commands and scripts
  - **File Preview** - View images and text documents with source highlighting and markdown rendering
  - **Diff Preview** - View the current diff when working in Git repositories
- **Right Bar** - File explorer, command history, and scratchpad

### Session Status Indicators

Each session shows a color-coded status indicator:

- 🟢 **Green** - Ready and waiting
- 🟡 **Yellow** - Agent is thinking
- 🔴 **Red** - No connection with agent
- 🟠 **Pulsing Orange** - Attempting to establish connection

## Keyboard Shortcuts

### Global Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Quick Actions | `Cmd+K` | `Ctrl+K` |
| Toggle Sidebar | `Cmd+B` | `Ctrl+B` |
| Toggle Right Panel | `Cmd+\` | `Ctrl+\` |
| New Agent | `Cmd+N` | `Ctrl+N` |
| Kill Agent | `Cmd+Shift+Backspace` | `Ctrl+Shift+Backspace` |
| Move Session to Group | `Cmd+Shift+M` | `Ctrl+Shift+M` |
| Previous Agent | `Cmd+Shift+{` | `Ctrl+Shift+{` |
| Next Agent | `Cmd+Shift+}` | `Ctrl+Shift+}` |
| Switch AI/Command Terminal | `Cmd+J` | `Ctrl+J` |
| Show Shortcuts Help | `Cmd+/` | `Ctrl+/` |
| Open Settings | `Cmd+,` | `Ctrl+,` |
| View Agent Sessions | `Cmd+Shift+L` | `Ctrl+Shift+L` |
| Cycle Focus Areas | `Tab` | `Tab` |
| Cycle Focus Backwards | `Shift+Tab` | `Shift+Tab` |

### Panel Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Go to Files Tab | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Go to History Tab | `Cmd+Shift+H` | `Ctrl+Shift+H` |
| Go to Scratchpad | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| Toggle Markdown Raw/Preview | `Cmd+E` | `Ctrl+E` |

### Input & Output

| Action | Key |
|--------|-----|
| Send Message | `Enter` or `Cmd+Enter` (configurable in Settings) |
| Multiline Input | `Shift+Enter` |
| Navigate Command History | `Up Arrow` while in input |
| Slash Commands | Type `/` to open autocomplete |
| Focus Output | `Esc` while in input |
| Focus Input | `Esc` while in output |
| Open Output Search | `/` while in output |
| Scroll Output | `Up/Down Arrow` while in output |
| Page Up/Down | `Alt+Up/Down Arrow` while in output |
| Jump to Top/Bottom | `Cmd+Up/Down Arrow` while in output |

### Navigation & Search

| Action | Key |
|--------|-----|
| Navigate Sessions | `Up/Down Arrow` while in sidebar |
| Select Session | `Enter` while in sidebar |
| Open Session Filter | `/` while in sidebar |
| Navigate Files | `Up/Down Arrow` while in file tree |
| Open File Tree Filter | `/` while in file tree |
| Open File Preview | `Enter` on selected file |
| Close Preview/Filter/Modal | `Esc` |

### File Preview

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Copy File Path | `Cmd+P` | `Ctrl+P` |
| Open Search | `/` | `/` |
| Scroll | `Up/Down Arrow` | `Up/Down Arrow` |
| Close | `Esc` | `Esc` |

*Most shortcuts are customizable in Settings > Shortcuts*

## Slash Commands

Maestro includes an extensible slash command system with autocomplete:

| Command | Description |
|---------|-------------|
| `/clear` | Clear the output history for the current mode |
| `/jump` | Jump to current working directory in file tree |

Type `/` in the input area to open the autocomplete menu, use arrow keys to navigate, and press `Tab` or `Enter` to select.

## Configuration

Settings are stored in:

- **macOS**: `~/Library/Application Support/maestro/`
- **Windows**: `%APPDATA%/maestro/`
- **Linux**: `~/.config/maestro/`

## Remote Access

Maestro includes a built-in web server for remote access:

1. **Local Access**: `http://localhost:8000`
2. **LAN Access**: `http://[your-ip]:8000`
3. **Public Access**: Enable ngrok or Cloudflare tunnel in Settings

### Enabling Public Tunnels

1. Get an API token from [ngrok.com](https://ngrok.com) or Cloudflare
2. Open Settings > Network
3. Select your tunnel provider and enter your API key
4. Start the tunnel from the session interface

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture details, and contribution guidelines.

## License

[MIT License](LICENSE)
