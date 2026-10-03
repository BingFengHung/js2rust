const examples = window.JS2RUST_EXAMPLES || {};
const jsCode = document.querySelector('#javascript-code');
const rustCode = document.querySelector('#rust-code');
const fullButton = document.querySelector('#full-rust');
let current = 'arrays';
let showFull = false;
let toastTimer;

function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}
function render() {
  const example = examples[current];
  if (!example) return;
  jsCode.textContent = example.javascript;
  rustCode.textContent = showFull ? example.rust : example.main;
  document.querySelector('#example-description').textContent =
    example.description;
  document.querySelector('#example-output').textContent = example.output;
  fullButton.setAttribute('aria-pressed', String(showFull));
  fullButton.textContent = showFull ? '只看主程式 −' : '展開完整 Rust ＋';
  document.querySelectorAll('[data-example]').forEach((button) => {
    const active = button.dataset.example === current;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.code-pane pre').forEach((pre) => {
    pre.scrollTop = 0;
    pre.scrollLeft = 0;
  });
}
document.querySelectorAll('[data-example]').forEach((button) =>
  button.addEventListener('click', () => {
    current = button.dataset.example;
    render();
  }),
);
fullButton.addEventListener('click', () => {
  showFull = !showFull;
  render();
});

async function copy(text) {
  if (navigator.clipboard && window.isSecureContext)
    return navigator.clipboard.writeText(text);
  const field = document.createElement('textarea');
  field.value = text;
  field.style.cssText = 'position:fixed;left:-9999px;top:0';
  field.setAttribute('aria-hidden', 'true');
  document.body.append(field);
  field.select();
  const success = document.execCommand('copy');
  field.remove();
  if (!success) throw new Error('Copy unavailable');
}
document.querySelectorAll('[data-copy], [data-command]').forEach((button) =>
  button.addEventListener('click', async () => {
    const previous = document.activeElement;
    const text = button.dataset.command
      ? document.querySelector(`#${button.dataset.command}-command`).textContent
      : examples[current]?.[button.dataset.copy];
    if (!text) {
      notify('範例載入失敗，請重新整理頁面。');
      return;
    }
    try {
      await copy(text);
      notify(
        button.dataset.copy === 'rust'
          ? '完整 Rust 已複製，包含必要輔助函式。'
          : '已複製到剪貼簿。',
      );
    } catch {
      notify('無法存取剪貼簿，請選取程式碼手動複製。');
    }
    previous?.focus({ preventScroll: true });
  }),
);

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');
function closeMenu() {
  navigation.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
}
menuButton.addEventListener('click', () => {
  const open = navigation.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});
navigation
  .querySelectorAll('a')
  .forEach((link) => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navigation.classList.contains('open')) {
    closeMenu();
    menuButton.focus();
  }
});
window.matchMedia('(min-width: 701px)').addEventListener('change', closeMenu);
render();
