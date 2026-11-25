import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function render(source, element, t) {
  const formulae = new Map(), prefix = crypto.randomUUID();
  function placeholder(token) {
    const id = `${prefix}-${formulae.size}`;
    if (formulae.size < 500) formulae.set(id, token);
    else return `<span>${t('reader.formulaCount')}</span>`;
    return `<span data-silk-math="${id}"></span>`;
  }
  const parser = new Marked({ breaks:false, extensions:[{
    name:'mathBlock', level:'block',
    start(src) { const m = /(?:^|\n)[ \t]*(?:\$\$|\\\[)/.exec(src); return m?.index; },
    tokenizer(src) {
      const m = /^(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])(?:[ \t]*(?:\n|$))/.exec(src);
      if (m) return { type:'mathBlock',raw:m[0],text:m[1] ?? m[2],display:true };
    }, renderer:placeholder
  }, {
    name:'mathInline', level:'inline',
    start(src) { const m = /\$|\\\(/.exec(src); return m?.index; },
    tokenizer(src) {
      const m = /^(?:\$(?!\$)(?=\S)((?:\\[^\n]|[^$\\\n])+?)\$(?!\d)|\\\(([\s\S]*?)\\\))/.exec(src);
      if (m) return { type:'mathInline',raw:m[0],text:m[1] ?? m[2],display:false };
    }, renderer:placeholder
  }] });
  element.innerHTML = DOMPurify.sanitize(parser.parse(source), {
    FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'style', 'input', 'form'],
    FORBID_ATTR: ['style', 'data-i18n', 'data-i18n-title', 'data-i18n-placeholder', 'data-i18n-label']
  });
  for (const node of element.querySelectorAll('[data-silk-math]')) {
    const token = formulae.get(node.dataset.silkMath); if (!token) continue;
    if (token.text.length > 8192) { node.textContent = t('reader.formulaLength'); continue; }
    // Only KaTeX-generated markup receives inline layout styles; source HTML remains sanitized.
    try { node.innerHTML = katex.renderToString(token.text, {displayMode:token.display,throwOnError:false,trust:false,strict:'ignore',maxExpand:100,maxSize:20,output:'htmlAndMathml',macros:{}}); }
    catch { node.textContent = token.text; }
  }
  element.querySelectorAll('a').forEach(a => { a.removeAttribute('href'); a.title = t('reader.externalLink'); });
}
