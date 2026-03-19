// popup.js — Claude Chat Exporter v0.4.3
const chatInfo = document.getElementById('chatInfo');
const exportBtn = document.getElementById('exportBtn');
const status = document.getElementById('status');

// On popup open, get metadata from content script
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.url?.includes('claude.ai')) {
    chatInfo.innerHTML = '<span class="label">请在 claude.ai 对话页面使用</span>';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: 'getMetadata' }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      chatInfo.innerHTML = '<span class="label">无法读取对话信息，请刷新页面后重试</span>';
      return;
    }

    const meta = response.data;
    chatInfo.innerHTML = `
      <div><span class="label">标题：</span><span class="value">${meta.title || '未知'}</span></div>
      <div><span class="label">项目：</span><span class="value">${meta.project || '无项目'}</span></div>
      <div><span class="label">消息数：</span><span class="value">${meta.messageCount || '?'}</span></div>
    `;
    exportBtn.disabled = false;
  });
});

exportBtn.addEventListener('click', () => {
  exportBtn.disabled = true;
  status.className = '';
  status.textContent = '正在导出...';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'exportChat' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        status.className = 'error';
        status.textContent = '导出失败：' + (response?.error || '未知错误');
        exportBtn.disabled = false;
        return;
      }

      const blob = new Blob([response.data.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const filename = response.data.filename;

      // Try downloads API first, fallback to link click
      if (chrome.downloads) {
        chrome.downloads.download({
          url: url,
          filename: filename,
          saveAs: true
        }, () => {
          if (chrome.runtime.lastError) {
            fallbackDownload(blob, filename);
          }
          status.className = 'success';
          status.textContent = `导出成功！${response.data.meta.messageCount} 条消息 💜`;
          exportBtn.disabled = false;
        });
      } else {
        fallbackDownload(blob, filename);
        status.className = 'success';
        status.textContent = `导出成功！${response.data.meta.messageCount} 条消息 💜`;
        exportBtn.disabled = false;
      }
    });
  });
});

function fallbackDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
