# Hush: Tab Audio Control & Auto-Mute

Version 0.1.3 · Chrome (Manifest V3, Chrome 110+) · MIT licensed

Local-first. No accounts, no sync, no analytics, no network requests from Hush's own code.

## Load it
chrome://extensions → Developer mode → Load unpacked → pick this folder.

## Features
- Mute others (Alt+M) / Mute all (Alt+Shift+M) / Auto-follow (Alt+A), all rebindable
- Auto-follow with grace delay, per-window or focused-window scope, pinned tabs exempt
- Badge count of tabs you can actually hear; toolbar icon changes with the mode
- Popup: "Playing now" + "Played in the last 10 minutes", jump to tab, per-tab mute
- Restore exactly: Hush only ever unmutes tabs it muted itself
- "Put everything back" and "Pause Hush"
- Settings page, light/dark/system theme, all strings via chrome.i18n (_locales/en)

## Permissions
- `storage` (required)
- `tabs` (optional, requested only when the user clicks "Show tab names")

## Contributing
Issues and pull requests are welcome. There is no build step: edit the files, then reload the extension at chrome://extensions. Please run through the checklist below before opening a PR.

## Manual test checklist (needs real Chrome)
1. Open 3 tabs with audio (e.g. YouTube x2 + one more). Press Alt+M: only the tab you're on keeps playing. Press again: all return.
2. Mute one tab yourself via Chrome first, then Alt+M twice: that tab must stay muted.
3. Turn on Auto-follow (Alt+A), switch tabs: sound moves with you after the grace delay.
4. Two windows: try both scope options in Settings.
5. Pin a tab with audio: auto-follow must not mute it.
6. Click "Show tab names" in the popup. Check the permission prompt appears and the list then shows titles. (If the popup closes when the prompt opens, the same button exists in Settings.)
7. Leave the browser idle ~1 min (worker sleeps), then switch tabs: follow must still work.
8. Restart Chrome: Hush starts clean (mode off); settings are kept.

## License
MIT, see `LICENSE`.
