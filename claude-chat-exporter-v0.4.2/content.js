// content.js
// Claude Chat Exporter v0.4.2 - Content Script
// ProjectD · Auto Memorizer Pipeline
//
// CHANGELOG v0.4.2:
//   - REWRITE: Completely new message extraction architecture
//     Instead of walking UP from font-claude-response to find a "turn container",
//     we now collect all message markers in DOM order and extract content
//     by looking at the RANGE between markers. This avoids the container-merge bug
//     where walking up N levels caused multiple turns to share one container.
//   - FIX: Human messages using <ol>/<ul>/<li> instead of <p> now correctly extracted
//   - FIX: Multiple Dorothy responses no longer merge into one giant message
//   - FIX: Human messages no longer pile up at the bottom
//   - Thinking/tool-use titles still exported as blockquote
//   - Ghost element filter preserved
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
    // The current project link is in the breadcrumb area (class="truncate")
    // near the chat title, NOT in the sidebar navigation.
    // Sidebar links have long class lists (inline-flex items-center justify-center...)
    // Breadcrumb link: <a class="truncate" href="/project/...">ProjectD</a>
    const allProjectLinks = document.querySelectorAll('a[href*="/project/"]');
    for (const a of allProjectLinks) {
      const cls = a.className || '';
      // Breadcrumb link has simple class like "truncate"
      // Sidebar links have complex multi-class strings
      if (cls.includes('truncate') && !cls.includes('inline-flex')) {
        project = a.textContent.trim();
        break;
      }
    }
    // Fallback: any project link that's not "Projects" (the nav header)
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
    // Look in the element and nearby siblings/parent for time info
    // Strategy: walk up a few levels and search within that area
    let searchArea = el;
    for (let i = 0; i < 5; i++) {
      const timeEl = searchArea.querySelector('time, [datetime]');
      if (timeEl) {
        return timeEl.getAttribute('datetime') || timeEl.textContent.trim();
      }
      // Check for timestamp in tooltip-style spans
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
  // HUMAN CONTENT EXTRACTION — v0.4.2
  // ============================================================

  function extractHumanContent(container, td) {
    const parts = [];

    // Use turndown on the whole container if possible — it handles p, ol, ul, li, etc.
    // But we need to exclude action buttons and timestamp areas
    
    // Strategy: find the actual content area (everything before the action bar)
    // The action bar has role="group" aria-label="Message actions"
    const actionBar = container.querySelector('[role="group"][aria-label]');
    
    // Clone container and remove action bar for clean extraction
    const clone = container.cloneNode(true);
    const cloneActionBar = clone.querySelector('[role="group"][aria-label]');
    if (cloneActionBar) {
      // Remove the action bar and everything after it
      let node = cloneActionBar.closest('div.flex');
      if (node && node.parentElement === clone) {
        node.remove();
      } else if (cloneActionBar.parentElement) {
        cloneActionBar.parentElement.remove();
      }
    }

    // Also remove any timestamp-only elements from clone
    clone.querySelectorAll('span.text-text-500.text-xs').forEach(el => {
      if (/^\d|^[上下]午/.test(el.textContent.trim())) {
        el.remove();
      }
    });

    // Try converting the clean clone
    const mdContent = convertHtmlToMd(clone, td);
    if (mdContent.trim()) {
      parts.push(mdContent.trim());
    }

    // Images (in case turndown missed them)
    if (!mdContent.includes('[图片')) {
      const images = container.querySelectorAll('img[src]');
      for (const img of images) {
        parts.push(`[图片${img.alt ? ': ' + img.alt : ''}]`);
      }
    }

    // If still nothing, raw text fallback
    if (parts.length === 0) {
      const text = container.textContent?.trim();
      if (text) parts.push(text);
    }

    return parts.join('\n\n').trim();
  }

  // ============================================================
  // ASSISTANT CONTENT EXTRACTION — v0.4.2
  // Extracts from the font-claude-response element AND its
  // neighboring thinking/artifact blocks within the same turn.
  // ============================================================

  function extractAssistantContent(responseEl, td) {
    const parts = [];
    const processed = new Set();

    // The font-claude-response element contains standard-markdown and artifact blocks.
    // Thinking buttons are SIBLINGS of some ancestor of font-claude-response.
    // Strategy: 
    //   1. Find thinking buttons that are "associated" with this response
    //      (between the previous human message and this response, or between
    //       this response and the next human message)
    //   2. Extract standard-markdown and artifact blocks from the response itself

    // --- Extract thinking titles ---
    // Walk up from responseEl to find the turn-level area that contains thinking buttons
    // But STOP before we hit a level that would include other turns
    let thinkingSearchArea = responseEl;
    for (let i = 0; i < 6; i++) {
      const parent = thinkingSearchArea.parentElement;
      if (!parent) break;
      // Stop if parent contains another font-claude-response (different turn)
      const responses = parent.querySelectorAll('.font-claude-response:not(.text-text-200)');
      const hasOtherResponse = Array.from(responses).some(r => r !== responseEl && !isGhostElement(r));
      if (hasOtherResponse) break;
      // Stop if parent contains a user-message (crossed into human turn territory)  
      if (parent.querySelector('[data-testid="user-message"]')) break;
      thinkingSearchArea = parent;
    }

    // Extract thinking buttons from this area
    const thinkingButtons = thinkingSearchArea.querySelectorAll('button[class*="group/status"]');
    for (const btn of thinkingButtons) {
      const title = extractThinkingTitle(btn);
      if (title) parts.push(`> ${title}`);
      processed.add(btn);
    }

    // --- Extract content from font-claude-response ---
    function walkContent(node) {
      if (processed.has(node)) return;

      // Standard markdown
      if (node.matches && node.matches('.standard-markdown')) {
        processed.add(node);
        const text = convertHtmlToMd(node, td);
        if (text.trim()) parts.push(text);
        return;
      }

      // Artifact block
      if (node.matches && (node.matches('.artifact-block-cell') || node.matches('[class*="artifact-block"]'))) {
        processed.add(node);
        parts.push(extractArtifactPlaceholder(node));
        return;
      }

      // Recurse into children
      if (node.children) {
        for (const child of node.children) {
          if (child.matches && child.matches('button[class*="group/status"]')) {
            // Already handled above
            continue;
          }
          walkContent(child);
        }
      }
    }

    walkContent(responseEl);

    // Also check the thinkingSearchArea for artifacts not inside responseEl
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
  // MAIN EXTRACTION — v0.4.2 Architecture
  //
  // Core change: we no longer try to find a "turn container" by
  // walking up the DOM. Instead, we:
  //   1. Collect all human [data-testid="user-message"] elements
  //   2. Collect all assistant .font-claude-response elements (non-ghost)
  //   3. Sort them by DOM position using compareDocumentPosition
  //   4. Deduplicate by checking if responseEl is the same DOM node
  //   5. Extract content directly from each element
  //
  // This avoids the container-merge bug entirely.
  // ============================================================

  function extractMessages() {
    const messages = [];
    const td = getTurndownService();

    // Collect all message markers
    const allMarkers = [];

    // Human messages
    document.querySelectorAll(
      '[data-testid="user-message"], [data-testid*="human-turn"], [data-testid*="user-human-turn"]'
    ).forEach(el => {
      allMarkers.push({ type: 'human', el });
    });

    // Assistant messages — use font-claude-response directly, no walk-up!
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

    // Deduplicate (same element appearing twice)
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
        const content = extractHumanContent(marker.el, td);
        messages.push({
          sender: 'human',
          senderName: 'Vincent',
          time: timestamp,
          content: content || '[空消息]',
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
    lines.push(`exporter: Claude Chat Exporter v0.4.2`);
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

  console.log('%c[Claude Chat Exporter] v0.4.2 loaded 💜', 'color: #9B59B6; font-weight: bold;');
})();
