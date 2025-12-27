---
title: Configuration
description: Storage locations, cross-device sync, and Maestro configuration options.
icon: settings
---

Settings are stored in:

- **macOS**: `~/Library/Application Support/maestro/`
- **Windows**: `%APPDATA%/maestro/`
- **Linux**: `~/.config/maestro/`

## Cross-Device Sync (Beta)

Maestro can sync settings, sessions, and groups across multiple devices by storing them in a cloud-synced folder like iCloud Drive, Dropbox, or OneDrive.

**Setup:**

1. Open **Settings** (`Cmd+,`) → **General** tab
2. Scroll to **Storage Location**
3. Click **Choose Folder...** and select a synced folder:
   - **iCloud Drive**: `~/Library/Mobile Documents/com~apple~CloudDocs/Maestro`
   - **Dropbox**: `~/Dropbox/Maestro`
   - **OneDrive**: `~/OneDrive/Maestro`
4. Maestro will migrate your existing settings to the new location
5. Restart Maestro for changes to take effect
6. Repeat on your other devices, selecting the same synced folder

**What syncs:**
- Settings and preferences
- Session configurations
- Groups and organization
- Agent configurations
- Session origins and metadata

**What stays local:**
- Window size and position (device-specific)
- The bootstrap file that points to your sync location

**Important limitations:**
- **Single-device usage**: Only run Maestro on one device at a time. Running simultaneously on multiple devices can cause sync conflicts where the last write wins.
- **No conflict resolution**: If settings are modified on two devices before syncing completes, one set of changes will be lost.
- **Restart required**: Changes to storage location require an app restart to take effect.

To reset to the default location, click **Use Default** in the Storage Location settings.
