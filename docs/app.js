const { render: highlightCode, languageForFile } = window.JS2RUST_HIGHLIGHT || {
  render: (target, source) => { target.textContent = source; },
  languageForFile: () => 'text',
};
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
  highlightCode(jsCode, example.javascript, 'javascript');
  highlightCode(rustCode, showFull ? example.rust : example.main, 'rust');
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

// Generated at build time from the Playground; no source execution in the browser.
const templates = window.JS2RUST_TEMPLATES || [];
const templateList = document.querySelector('#template-list');
const templateSearch = document.querySelector('#template-search');
const templateCategory = document.querySelector('#template-category');
const templateLanguage = document.querySelector('#template-language');
const templateFile = document.querySelector('#template-file');
const templateCode = document.querySelector('#template-code');
let selectedTemplate = templates[0];
for (const category of new Set(templates.map((t) => t.category))) {
  const option = document.createElement('option');
  option.value = category;
  option.textContent = category;
  templateCategory.append(option);
}
function renderTemplateFile() {
  const source = selectedTemplate?.[templateLanguage.value]?.[templateFile.value] || '';
  highlightCode(templateCode, source, languageForFile(templateFile.value));
  templateCode.parentElement.scrollTop = 0;
  templateCode.parentElement.scrollLeft = 0;
}
function renderTemplateDetail() {
  if (!selectedTemplate) return;
  document.querySelector('#template-title').textContent =
    selectedTemplate.title;
  document.querySelector('#template-group').textContent =
    selectedTemplate.category;
  document.querySelector('#template-note').textContent =
    `${Object.keys(selectedTemplate.files).length} 個來源檔案 · 完整 Cargo 專案可在下方檢視。部分範本使用 TypeScript 註記或專案提供的 Rust API 寫法。`;
  templateFile.replaceChildren();
  for (const file of Object.keys(selectedTemplate[templateLanguage.value])) {
    const option = document.createElement('option');
    option.value = file;
    option.textContent = file;
    templateFile.append(option);
  }
  renderTemplateFile();
}
function renderTemplateList() {
  const query = templateSearch.value.trim().toLocaleLowerCase();
  const visible = templates.filter(
    (t) =>
      (!templateCategory.value || t.category === templateCategory.value) &&
      `${t.title} ${t.category} ${Object.keys(t.files).join(' ')} ${Object.values(t.files).join(' ')}`
        .toLocaleLowerCase()
        .includes(query),
  );
  if (!visible.includes(selectedTemplate)) selectedTemplate = visible[0];
  document.querySelector('#template-count').textContent =
    `${visible.length} / ${templates.length} 個範本`;
  document.querySelector('.template-detail').hidden = !visible.length;
  templateList.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.textContent = '找不到符合條件的範本，請調整搜尋或分類。';
    templateList.append(empty);
  }
  for (const template of visible) {
    const button = document.createElement('button');
    button.className = 'template-card';
    button.dataset.template = template.id;
    button.setAttribute('aria-pressed', String(template === selectedTemplate));
    const title = document.createElement('strong');
    title.textContent = template.title;
    const detail = document.createElement('span');
    detail.textContent = `${Object.keys(template.files).length} 個來源檔案`;
    button.append(title, detail);
    button.addEventListener('click', () => {
      selectedTemplate = template;
      templateList
        .querySelectorAll('button')
        .forEach((b) =>
          b.setAttribute(
            'aria-pressed',
            String(b.dataset.template === template.id),
          ),
        );
      renderTemplateDetail();
    });
    templateList.append(button);
  }
  renderTemplateDetail();
}
templateSearch.addEventListener('input', renderTemplateList);
templateCategory.addEventListener('change', renderTemplateList);
templateLanguage.addEventListener('change', renderTemplateDetail);
templateFile.addEventListener('change', renderTemplateFile);
document.querySelector('#template-copy').addEventListener('click', async () => {
  try {
    await copy(templateCode.textContent);
    notify('範本檔案已複製。');
  } catch {
    notify('無法存取剪貼簿，請選取程式碼手動複製。');
  }
});
document.querySelector('#template-download').addEventListener('click', () => {
  if (!selectedTemplate) return;
  const backup = {
    version: '1.0',
    folders: selectedTemplate.folders,
    files: selectedTemplate.files,
    activeFile: Object.keys(selectedTemplate.files)[0],
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `js2rust-${selectedTemplate.id}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('專案備份已下載，可匯入本機 Playground。');
});
renderTemplateList();
