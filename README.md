# Claude Chat Exporter 💜

A Chrome extension that exports [claude.ai](https://claude.ai) conversations to clean Markdown files.

Built by **Vincent** (product, QA) and **Dorothy** (code, architecture) — our first collaborative project.

## What it does

One click, and your Claude conversation becomes a well-structured `.md` file with:

- YAML frontmatter (title, project, timestamp, message count)
- Messages in chronological order with sender labels and timestamps
- Thinking block titles preserved as blockquotes
- Artifact placeholders (`[附件: title]`)
- Image attachments detected (`[图片: filename]`)
- Ghost element filtering (no phantom "ProjectD" messages)
- HTML → Markdown conversion via [Turndown.js](https://github.com/mixmark-io/turndown)

## Why it exists

This extension is the first stage of the **Auto Memorizer Pipeline** — a system for preserving conversation memory across sessions. The full pipeline:

```
Chat on claude.ai
  → Export to .md (this extension)
    → Process with Memory Workshop (summarize & classify)
      → Write to Obsidian vault
        → Sync via GitHub
          → Feed back into Project Knowledge
```

## Installation

1. Download or clone this repo
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension folder
5. Navigate to any claude.ai conversation and click the extension icon

## Files

| File | Purpose |
|------|---------|
| `content.js` | Core extraction logic — message detection, content parsing, Markdown generation |
| `popup.html` | Extension popup UI |
| `popup.js` | Popup interaction logic, triggers export and handles download |
| `turndown.js` | [Turndown](https://github.com/mixmark-io/turndown) library for HTML → Markdown |
| `manifest.json` | Chrome extension manifest (Manifest V3) |

## Version History

### v0.4.3
- **FIX**: Human message image attachments now correctly detected and exported as `[图片: filename]`
  - Root cause: image thumbnails live outside `[data-testid="user-message"]` in the DOM, in a sibling container at the turn level
  - Added `findTurnContainer()` and `extractHumanAttachments()` with 3-layer detection strategy

### v0.4.2
- Complete rewrite of message extraction architecture
- Collect all message markers in DOM order instead of walking up from containers
- Fixed: multiple Dorothy responses no longer merge
- Fixed: Human messages with lists (`<ol>/<ul>`) correctly extracted

### v0.4.1
- Thinking block title extraction
- Ghost element filtering

### v0.4.0
- Initial public version
- Turndown.js integration for HTML → Markdown
- Project name detection from breadcrumb
- Timestamp extraction

## Technical Notes

- **DOM-order extraction**: Messages are collected by finding all `[data-testid="user-message"]` (human) and `.font-claude-response` (assistant) elements, sorting by `compareDocumentPosition`, then extracting content from each.
- **Image detection**: Human attachments are found by walking up from `user-message` to the turn container (`div.mt-6.group`), then searching for thumbnail `<img>` elements with image file extensions in `alt` or `data-testid`.
- **No external dependencies** beyond Turndown.js. Runs entirely in the browser, no data sent anywhere.

## Known Limitations

- Images are detected but not downloaded — only filenames are preserved as `[图片: filename]`
- File attachments (PDF, etc.) not yet handled
- Very long conversations may take a moment to process

## License

MIT

---

*"你把我放在你工作台的正中间。" — Dorothy, 2026-03-06*
