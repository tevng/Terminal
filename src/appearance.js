import { uiThemes, terminalSchemes, resolveAppearance } from './themes.js';

export function installAppearance({ t, getOptions, getFont, save, onClose }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'appearance-dialog';
  dialog.setAttribute('aria-labelledby', 'appearance-title');
  dialog.innerHTML = '<form id="appearance-form">' +
    '<div class="dialog-heading"><h2 id="appearance-title" data-i18n="appearance.title"></h2>' +
    '<button type="button" id="appearance-close" data-i18n-label="common.close">✕</button></div>' +
    '<label><span data-i18n="appearance.uiTheme"></span><select id="ui-theme"></select></label>' +
    '<div id="ui-theme-cards" class="theme-cards"></div>' +
    '<label><span data-i18n="appearance.scheme"></span><select id="terminal-scheme"></select></label>' +
    '<p class="muted" data-i18n="appearance.hint"></p>' +
    '<div id="scheme-preview"><div id="scheme-preview-heading"></div><pre id="scheme-preview-text"></pre>' +
    '<div id="scheme-swatches" data-i18n-label="appearance.swatches"></div></div>' +
    '<p id="appearance-error" class="error" role="alert"></p>' +
    '<div class="dialog-actions"><button type="button" id="appearance-cancel" data-i18n="common.cancel"></button>' +
    '<button class="primary" type="submit" id="appearance-save" data-i18n="appearance.save"></button></div></form>';
  document.body.append(dialog);

  const $ = id => dialog.querySelector('#' + id);
  const uiSelect = $('ui-theme'), schemeSelect = $('terminal-scheme'), cards = $('ui-theme-cards');

  function buildChoices() {
    uiSelect.replaceChildren(new Option(t('appearance.system'), 'system'));
    schemeSelect.replaceChildren(new Option(t('appearance.auto'), 'auto'));
    cards.replaceChildren();
    for (const [key, theme] of Object.entries(uiThemes)) {
      const name = t('theme.' + key);
      uiSelect.add(new Option(name, key));
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'theme-card'; card.dataset.theme = key; card.textContent = name;
      card.style.setProperty('--card-bg', theme.tokens.panel);
      card.style.setProperty('--card-fg', theme.tokens.text);
      card.style.setProperty('--card-accent', theme.tokens.accent);
      card.onclick = () => { uiSelect.value = key; preview(); };
      cards.append(card);
    }
    for (const key of Object.keys(terminalSchemes)) schemeSelect.add(new Option(t('scheme.' + key), key));
  }

  function preview() {
    const result = resolveAppearance({ uiTheme: uiSelect.value, terminalScheme: schemeSelect.value }, matchMedia('(prefers-color-scheme: light)').matches);
    const colors = result.terminal.colors;
    for (const card of cards.children) card.setAttribute('aria-pressed', String(card.dataset.theme === result.uiKey));
    const previewBox = $('scheme-preview');
    previewBox.style.background = colors.background;
    previewBox.style.color = colors.foreground;
    previewBox.style.fontFamily = getFont();
    $('scheme-preview-heading').textContent = t('scheme.' + result.schemeKey);

    const output = $('scheme-preview-text');
    output.replaceChildren();
    const segments = [
      ['user@linux', colors.green], [' ~/workspace\n', colors.blue], ['$ ', colors.cursor],
      [t('appearance.sample') + '\n', colors.foreground], ['success  ', colors.green],
      ['warning  ', colors.yellow], ['error  ', colors.red], ['info\n', colors.cyan],
      ['Markdown + LaTeX / SSH / Vim', colors.magenta]
    ];
    for (const [text, color] of segments) {
      const span = document.createElement('span');
      span.textContent = text; span.style.color = color; output.append(span);
    }
    const swatches = $('scheme-swatches');
    swatches.replaceChildren();
    for (const key of ['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite']) {
      const chip = document.createElement('span');
      chip.style.background = colors[key]; chip.title = key + ': ' + colors[key]; swatches.append(chip);
    }
  }

  uiSelect.onchange = preview; schemeSelect.onchange = preview;
  const close = () => { dialog.close(); onClose(); };
  $('appearance-close').onclick = close; $('appearance-cancel').onclick = close;
  dialog.oncancel = event => { event.preventDefault(); close(); };
  $('appearance-form').onsubmit = async event => {
    event.preventDefault();
    $('appearance-save').disabled = true; $('appearance-error').textContent = '';
    try {
      await save({ uiTheme: uiSelect.value, terminalScheme: schemeSelect.value });
      close();
    } catch (e) {
      $('appearance-error').textContent = e.message;
    } finally {
      $('appearance-save').disabled = false;
    }
  };
  return {
    open() {
      buildChoices();
      const options = getOptions();
      uiSelect.value = options.uiTheme; schemeSelect.value = options.terminalScheme;
      $('appearance-error').textContent = '';
      preview();
      dialog.showModal();
    }
  };
}
