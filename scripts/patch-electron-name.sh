#!/bin/bash
# Patch Electron.app Info.plist so macOS dock shows "Cate" instead of "Electron"
PLIST="node_modules/electron/dist/Electron.app/Contents/Info.plist"
if [ -f "$PLIST" ]; then
  /usr/libexec/PlistBuddy -c "Set CFBundleDisplayName Cate" "$PLIST" 2>/dev/null
  /usr/libexec/PlistBuddy -c "Set CFBundleName Cate" "$PLIST" 2>/dev/null
  # Also replace the .icns
  cp build/icon.icns "node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns" 2>/dev/null
fi
