chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'vozza-insert-text') insertText(msg.text);
  if (msg.type === 'vozza-toast') showToast(msg.text);
});

function insertText(text) {
  navigator.clipboard?.writeText(text).catch(() => {});

  const el = document.activeElement;
  if (!el) {
    showToast('Texto copiado — cole com Cmd/Ctrl+V');
    return;
  }

  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    showToast('Texto inserido ✓');
    return;
  }

  // Editores contenteditable (Gmail, WhatsApp Web, Slack web, etc.)
  if (el.isContentEditable && document.execCommand('insertText', false, text)) {
    showToast('Texto inserido ✓');
    return;
  }

  // Editores baseados em canvas (Google Docs) não aceitam inserção via DOM.
  showToast('Não consegui inserir aqui — texto copiado, cole com Cmd/Ctrl+V');
}

function showToast(message) {
  let toast = document.getElementById('__vozza_toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '__vozza_toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
      'background:#111319', 'color:#fff', 'padding:12px 18px', 'border-radius:999px',
      'font:500 14px -apple-system,BlinkMacSystemFont,sans-serif',
      'box-shadow:0 12px 30px rgba(0,0,0,.3)', 'opacity:0',
      'transition:opacity .2s ease', 'pointer-events:none',
    ].join(';');
    document.documentElement.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(toast._vozzaTimer);
  toast._vozzaTimer = setTimeout(() => {
    toast.style.opacity = '0';
  }, 2600);
}
