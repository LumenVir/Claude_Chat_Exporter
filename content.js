// content.js
// Claude Chat Exporter v0.4.4 - Content Script
// ProjectD · Auto Memorizer Pipeline
//
// CHANGELOG v0.4.4:
//   - FIX: File attachments (zip, html, md, pdf, etc.) now detected and exported as [附件: filename]
//     Root cause: Same as image thumbnails — file thumbnails live OUTSIDE [data-testid="user-message"],
//     in a sibling container at the turn level, using data-testid="file-thumbnail" with <h3> for filename.
//   - extractHumanAttachments() now has 2 phases: file attachments first, then image attachments
//   - File attachments: [附件: filename.ext], Image attachments: [图片: filename]
//
// CHANGELOG v0.4.3:
//
// ============================================================

(function () {
  'use strict';

  // ============================================================
  // METADATA
  // ============================================================

  function getMetadata() {
    let title = '';
    const titleBtn = document.querySelector('button[data-testid="chat-title-button"]');
    if (titleBtn) title = titleBtn.textContent.trim();
    if (!title) {
      const h1 = document.querySelector('h1');
      if (h1) title = h1.textContent.trim();
    }

    let project = '';
    const allProjectLinks = document.querySelectorAll('a[href*="/project/"]');
    for (const a of allProjectLinks) {
      const cls = a.className || '';
      if (cls.includes('truncate') && !cls.includes('inline-flex')) {
        project = a.textContent.trim();
        break;
      }
    }
    if (!project) {
      for (const a of allProjectLinks) {
        const text = a.textContent.trim();
        if (text && text !== 'Projects' && !text.includes('\n')) {
          project = text;
          break;
        }
      }
    }

    return { title, project };
  }

  // ============================================================
  // TURNDOWN
  // ============================================================

  function getTurndownService() {
    if (typeof TurndownService === 'undefined') {
      console.warn('[Exporter] TurndownService not available');
      return null;
    }
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    td.addRule('strikethrough', {
      filter: ['del', 's', 'strike'],
      replacement: (content) => `~~${content}~~`,
    });
    return td;
  }

  function convertHtmlToMd(element, td) {
    if (td) {
      try {
        return td.turndown(element.innerHTML);
      } catch (e) {
        console.warn('[Exporter] Turndown failed:', e);
      }
    }
    return element.textContent.trim();
  }

  // ============================================================
  // GHOST FILTER
  // ============================================================

  function isGhostElement(el) {
    if (!el) return false;
    const cls = el.className || '';
    if (cls.includes('text-text-200') && cls.includes('leading-tight')) return true;
    const text = el.textContent?.trim();
    if (text === 'ProjectD' || text === '') return true;
    return false;
  }

  // ============================================================
  // THINKING TITLE EXTRACTION
  // ============================================================

  function extractThinkingTitle(button) {
    const titleSpan = button.querySelector('span.truncate, span.text-sm');
    if (titleSpan) return titleSpan.textContent.trim();
    return button.textContent.trim().split('\n')[0].trim();
  }

  // ============================================================
  // ARTIFACT PLACEHOLDER
  // ============================================================

  function extractArtifactPlaceholder(container) {
    let title = '';
    let type = '';

    const titleEl = container.querySelector('.line-clamp-1, [class*="leading-tight"]');
    if (titleEl) title = titleEl.textContent.trim();

    const typeEl = container.querySelector('.text-xs, [class*="text-text-400"]');
    if (typeEl) type = typeEl.textContent.trim();

    if (!title) {
      const ariaBtn = container.querySelector('[aria-label*="Open artifact"]');
      if (ariaBtn) title = ariaBtn.getAttribute('aria-label').replace('Open artifact: ', '');
    }

    if (!title) title = '未命名附件';
    return `[附件: ${title}${type ? ' (' + type + ')' : ''}]`;
  }

  // ============================================================
  // TIMESTAMP EXTRACTION
  // ============================================================

  function extractTimestamp(el) {
    let searchArea = el;
    for (let i = 0; i < 5; i++) {
      const timeEl = searchArea.querySelector('time, [datetime]');
      if (timeEl) {
        return timeEl.getAttribute('datetime') || timeEl.textContent.trim();
      }
      const spans = searchArea.querySelectorAll('span.text-text-500.text-xs');
      for (const span of spans) {
        const text = span.textContent.trim();
        if (/\d{1,2}:\d{2}/.test(text) || /[上下]午/.test(text)) {
          return text;
        }
      }
      if (searchArea.parentElement) {
        searchArea = searchArea.parentElement;
      } else {
        break;
      }
    }
    return '';
  }

  // ============================================================
  // HUMAN ATTACHMENTS EXTRACTION — v0.4.4
  //
  // Both file attachments and image attachments live OUTSIDE the
  // user-message element, in sibling containers at the turn level.
  //
  // FILE ATTACHMENTS (zip, html, md, pdf, etc.):
  //   div.mb-1.mt-6.group  (turn container)
  //     ├── div.flex.flex-wrap.justify-end  (thumbnails row)
  //     │     └── div.group/thumbnail[data-testid="file-thumbnail"]
  //     │           └── button
  //     │                 ├── h3 → filename (e.g. "report.pdf")
  //     │                 └── p.uppercase → extension label
  //     └── div[data-testid="user-message"]
  //
  // IMAGE ATTACHMENTS (jpg, png, etc.):
  //   div.mb-1.mt-6.group  (turn container)
  //     ├── div.flex.flex-wrap.justify-end  (thumbnails row)
  //     │     └── div.group/thumbnail
  //     │           └── div[data-testid="filename.png"]
  //     │                 └── button > img[alt="filename.png"]
  //     └── div[data-testid="user-message"]
  // ============================================================

  function findTurnContainer(el) {
    let current = el;
    for (let i = 0; i < 10; i++) {
      if (!current.parentElement) break;
      current = current.parentElement;
      const cls = current.className || '';
      if (cls.includes('mt-6') && cls.includes('group')) {
        return current;
      }
    }
    return null;
  }

  function extractHumanAttachments(userMessageEl) {
    const attachments = [];
    const turnContainer = findTurnContainer(userMessageEl);
    if (!turnContainer) return attachments;

    // ---- Phase 1: File attachments (data-testid="file-thumbnail") ----
    const fileThumbnails = turnContainer.querySelectorAll(
      '[data-testid="file-thumbnail"]'
    );
    const detectedFiles = new Set();
    for (const thumb of fileThumbnails) {
      // The filename is in the <h3> element inside the thumbnail
      const h3 = thumb.querySelector('h3');
      if (h3) {
        const filename = h3.textContent.trim();
        if (filename && !detectedFiles.has(filename)) {
          detectedFiles.add(filename);
          attachments.push(`[附件: ${filename}]`);
        }
      }
    }

    // ---- Phase 2: Image attachments (same logic as v0.4.3) ----
    // Strategy 2a: img elements inside thumbnail containers (non-file thumbnails)
    const thumbnailImgs = turnContainer.querySelectorAll(
      '.group\\/thumbnail img[alt], [class*="group/thumbnail"] img[alt]'
    );
    for (const img of thumbnailImgs) {
      // Skip images that are inside file-thumbnail containers (already handled above)
      const parentThumb = img.closest('[data-testid="file-thumbnail"]');
      if (parentThumb) continue;

      const alt = img.getAttribute('alt') || '';
      if (alt) {
        attachments.push(`[图片: ${alt}]`);
      } else {
        attachments.push('[图片]');
      }
    }

    // Strategy 2b: data-testid with image extensions
    if (!thumbnailImgs.length) {
      const imgTestIds = turnContainer.querySelectorAll(
        'div[data-testid$=".jpg"], div[data-testid$=".jpeg"], div[data-testid$=".png"], div[data-testid$=".gif"], div[data-testid$=".webp"]'
      );
      for (const div of imgTestIds) {
        const testId = div.getAttribute('data-testid') || '';
        if (testId) {
          attachments.push(`[图片: ${testId}]`);
        }
      }
    }

    // Strategy 2c: fallback — large img tags with preview/blob src
    if (attachments.length === 0) {
      const allImgs = turnContainer.querySelectorAll('img[src]');
      for (const img of allImgs) {
        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || '';
        const width = img.width || parseInt(img.style?.width) || 0;
        if (width > 50 || src.includes('preview') || src.includes('blob:')) {
          if (alt && /\.(jpg|jpeg|png|gif|webp)$/i.test(alt)) {
            attachments.push(`[图片: ${alt}]`);
          } else if (!alt || !attachments.some(a => a.includes(alt))) {
            attachments.push('[图片]');
          }
        }
      }
    }

    return attachments;
  }

  // ============================================================
  // HUMAN CONTENT EXTRACTION — v0.4.2 (preserved)
  // ============================================================

  function extractHumanContent(container, td) {
    const parts = [];

    const actionBar = container.querySelector('[role="group"][aria-label]');

    const clone = container.cloneNode(true);
    const cloneActionBar = clone.querySelector('[role="group"][aria-label]');
    if (cloneActionBar) {
      let node = cloneActionBar.closest('div.flex');
      if (node && node.parentElement === clone) {
        node.remove();
      } else if (cloneActionBar.parentElement) {
        cloneActionBar.parentElement.remove();
      }
    }

    clone.querySelectorAll('span.text-text-500.text-xs').forEach(el => {
      if (/^\d|^[上下]午/.test(el.textContent.trim())) {
        el.remove();
      }
    });

    const mdContent = convertHtmlToMd(clone, td);
    if (mdContent.trim()) {
      parts.push(mdContent.trim());
    }

    if (parts.length === 0) {
      const text = container.textContent?.trim();
      if (text) parts.push(text);
    }

    return parts.join('\n\n').trim();
  }

  // ============================================================
  // ASSISTANT CONTENT EXTRACTION — v0.4.2 (preserved)
  // ============================================================

  function extractAssistantContent(responseEl, td) {
    const parts = [];
    const processed = new Set();

    let thinkingSearchArea = responseEl;
    for (let i = 0; i < 6; i++) {
      const parent = thinkingSearchArea.parentElement;
      if (!parent) break;
      const responses = parent.querySelectorAll('.font-claude-response:not(.text-text-200)');
      const hasOtherResponse = Array.from(responses).some(r => r !== responseEl && !isGhostElement(r));
      if (hasOtherResponse) break;
      if (parent.querySelector('[data-testid="user-message"]')) break;
      thinkingSearchArea = parent;
    }

    const thinkingButtons = thinkingSearchArea.querySelectorAll('button[class*="group/status"]');
    for (const btn of thinkingButtons) {
      const title = extractThinkingTitle(btn);
      if (title) parts.push(`> ${title}`);
      processed.add(btn);
    }

    function walkContent(node) {
      if (processed.has(node)) return;

      if (node.matches && node.matches('.standard-markdown')) {
        processed.add(node);
        const text = convertHtmlToMd(node, td);
        if (text.trim()) parts.push(text);
        return;
      }

      if (node.matches && (node.matches('.artifact-block-cell') || node.matches('[class*="artifact-block"]'))) {
        processed.add(node);
        parts.push(extractArtifactPlaceholder(node));
        return;
      }

      if (node.children) {
        for (const child of node.children) {
          if (child.matches && child.matches('button[class*="group/status"]')) {
            continue;
          }
          walkContent(child);
        }
      }
    }

    walkContent(responseEl);

    if (thinkingSearchArea !== responseEl) {
      const artifacts = thinkingSearchArea.querySelectorAll('.artifact-block-cell');
      for (const art of artifacts) {
        if (!processed.has(art)) {
          processed.add(art);
          parts.push(extractArtifactPlaceholder(art));
        }
      }
    }

    return parts.join('\n\n').trim();
  }

  // ============================================================
  // MAIN EXTRACTION — v0.4.4
  //
  // Same architecture as v0.4.2 (DOM-order marker collection),
  // with added attachment extraction for human messages.
  // ============================================================

  function extractMessages() {
    const messages = [];
    const td = getTurndownService();

    const allMarkers = [];

    // Human messages
    document.querySelectorAll(
      '[data-testid="user-message"], [data-testid*="human-turn"], [data-testid*="user-human-turn"]'
    ).forEach(el => {
      allMarkers.push({ type: 'human', el });
    });

    // Assistant messages
    document.querySelectorAll('.font-claude-response').forEach(el => {
      if (isGhostElement(el)) return;
      allMarkers.push({ type: 'assistant', el });
    });

    // Sort by DOM order
    allMarkers.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    // Deduplicate
    const seen = new Set();
    const deduped = allMarkers.filter(m => {
      if (seen.has(m.el)) return false;
      seen.add(m.el);
      return true;
    });

    // Extract content
    for (const marker of deduped) {
      if (marker.type === 'human') {
        const timestamp = extractTimestamp(marker.el);
        const textContent = extractHumanContent(marker.el, td);

        // v0.4.4: Extract attachments (files + images) from the turn container
        const attachments = extractHumanAttachments(marker.el);

        // Combine: attachments first, then text content
        const contentParts = [];
        if (attachments.length > 0) {
          contentParts.push(attachments.join('\n'));
        }
        if (textContent) {
          contentParts.push(textContent);
        }

        const finalContent = contentParts.join('\n\n') || '[空消息]';

        messages.push({
          sender: 'human',
          senderName: 'Vincent',
          time: timestamp,
          content: finalContent,
        });
      } else {
        const timestamp = extractTimestamp(marker.el);
        const content = extractAssistantContent(marker.el, td);
        if (content) {
          messages.push({
            sender: 'assistant',
            senderName: 'Dorothy',
            time: timestamp,
            content: content,
          });
        }
      }
    }

    // Final filter
    return messages.filter(m => {
      if (!m.content || m.content.trim() === '') return false;
      if (m.content === 'ProjectD') return false;
      if (m.content.startsWith('ProjectD') && m.content.length < 50) return false;
      return true;
    });
  }

  // ============================================================
  // MARKDOWN GENERATION
  // ============================================================

  function generateMarkdown(meta, messages) {
    const lines = [];

    lines.push('---');
    lines.push(`title: "${(meta.title || '未命名').replace(/"/g, '\\"')}"`);
    if (meta.project) lines.push(`project: "${meta.project}"`);
    lines.push(`exported: ${new Date().toISOString()}`);
    lines.push(`exporter: Claude Chat Exporter v0.4.4`);
    lines.push(`messages: ${meta.messageCount || messages.length}`);
    lines.push('---');
    lines.push('');

    for (const msg of messages) {
      const timeLabel = msg.time ? ` | ${msg.time}` : '';
      lines.push(`## ${msg.senderName}${timeLabel}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  function generateFilename(metadata) {
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = (metadata.title || '未命名')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 60);
    return `${date}_${safeTitle}.md`;
  }

  // ============================================================
  // MESSAGE HANDLER
  // ============================================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request.action === 'getMetadata') {
        const meta = getMetadata();
        const humanCount = document.querySelectorAll('[data-testid="user-message"], [data-testid*="human-turn"]').length;
        const assistantCount = document.querySelectorAll('.font-claude-response:not(.text-text-200)').length;
        meta.messageCount = humanCount + assistantCount;
        sendResponse({ success: true, data: meta });
      }
      else if (request.action === 'exportChat') {
        const meta = getMetadata();
        const messages = extractMessages();
        meta.messageCount = messages.length;

        if (messages.length === 0) {
          sendResponse({
            success: false,
            error: '未能提取到消息。请确认页面是 claude.ai 对话，且有消息内容。'
          });
          return;
        }

        const markdown = generateMarkdown(meta, messages);
        const filename = generateFilename(meta);

        sendResponse({
          success: true,
          data: { markdown, filename, meta }
        });
      }
    } catch (err) {
      console.error('[Claude Chat Exporter] Error:', err);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  });

  console.log('%c[Claude Chat Exporter] v0.4.4 loaded 💜', 'color: #9B59B6; font-weight: bold;');
})();
