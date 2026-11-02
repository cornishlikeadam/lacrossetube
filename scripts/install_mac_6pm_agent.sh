#!/usr/bin/env bash
# ============================================================================
# LACROSSETUBE // ST-100 MAC LAUNCHD INSTALLER (Runs daily at 6:00 PM / 18:00)
# ============================================================================
set -e

PLIST_PATH="$HOME/Library/LaunchAgents/com.lacrossetube.daily6pm.plist"
REPO_DIR="/Users/kjcornish/.gemini/antigravity/scratch/lacrossetube"

cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lacrossetube.daily6pm</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>${REPO_DIR}/daily_6pm_curator.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>18</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${REPO_DIR}/data/6pm_cron.log</string>
    <key>StandardErrorPath</key>
    <string>${REPO_DIR}/data/6pm_cron_err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "✅ Installed macOS 6:00 PM LaunchAgent -> $PLIST_PATH"
