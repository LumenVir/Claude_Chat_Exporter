// content.js
// Claude Chat Exporter v0.4.3 - Content Script
// ProjectD · Auto Memorizer Pipeline
//
// CHANGELOG v0.4.3:
//   - FIX #1: Human message image attachments now detected and exported as [图片: filename]
//     Root cause: Image thumbnails live OUTSIDE the [data-testid="user-message"] element,
//     in a sibling container higher up in the turn. The old code only looked inside user-message.
//     New approach: When processing a human marker, walk up to find the turn container
//     (div with class "mb-1 mt-6 group"), then search for image thumbnails within it.
//   - NEW: extractHumanAttachments() function for finding image thumbnails in turn container
//   - Preserved all v0.4.2 functionality (thinking titles, artifacts, ghost filter, etc.)
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
  // HUMAN ATTACHMENTS EXTRACTION — v0.4.3 NEW
  //
  // Image thumbnails in Claude's UI live OUTSIDE the user-message
  // element. They are in a sibling container at the turn level:
  //
  //   div.mb-1.mt-6.group  (turn container)
  //     ├── div.flex.flex-wrap.justify-end  (thumbnails row)
  //     │     └── div.group/thumbnail
  //     │           └── div[data-testid="filename.jpg"]
  //     │                 └── button > img[alt="filename.jpg"]
  //     └── div.flex.flex-col.items-end
  //           └── div[data-testid="user-message"]
  //
  // Strategy: from the user-message element, walk up to find the
  // turn container, then look for thumbnail images within it.
  // ============================================================

  function findTurnContainer(el) {
    let current = el;
    for (let i = 0; i < 10; i++) {
      if (!current.parentElement) break;
      current = current.parentElement;
      const cls = current.className || '';
      // Turn container has classes like "mb-1 mt-6 group"
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

    // Strategy 1: Find img elements inside thumbnail containers
    const thumbnailImgs = turnContainer.querySelectorAll(
      '.group\\/thumbnail img[alt], [class*="group/thumbnail"] img[alt]'
    );
    for (const img of thumbnailImgs) {
      const alt = img.getAttribute('alt') || '';
      if (alt) {
        attachments.push(`[图片: ${alt}]`);
      } else {
        attachments.push('[图片]');
      }
    }

    // Strategy 2: If strategy 1 found nothing, look for data-testid with image extensions
    if (attachments.length === 0) {
      const imgTestIds = turnContainer.querySelectorAll(
        'div[data-testid$=".jpg"], div[data-testid$=".jpeg"], div[data-testid$=".png"], div[data-testid$=".gif"], div[data-testid$=".webp"]'
      );
      for (const div of imgTestIds) {
        const testId = div.getAttribute('data-testid') || '';
        // Make sure this is above/before the user-message, not inside Dorothy's response
        // Check that it's within the same turn container
        if (testId) {
          attachments.push(`[图片: ${testId}]`);
        }
      }
    }

    // Strategy 3: Look for img tags with src containing "preview" or blob URLs
    // (fallback for edge cases)
    if (attachments.length === 0) {
      const allImgs = turnContainer.querySelectorAll('img[src]');
      for (const img of allImgs) {
        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || '';
        // Skip tiny icons and UI elements
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
  // MAIN EXTRACTION — v0.4.3
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

        // v0.4.3: Extract image attachments from the turn container
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
    lines.push(`exporter: Claude Chat Exporter v0.4.3`);
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

  console.log('%c[Claude Chat Exporter] v0.4.3 loaded 💜', 'color: #9B59B6; font-weight: bold;');
})();
