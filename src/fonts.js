import {uiThemes,terminalSchemes} from './themes.js';
export const defaults = {
  latin: 'Comic Mono, Consolas', cjk: 'NSimSun, SimSun', math: 'Cambria Math, STIX Two Math, Segoe UI Symbol',
  emoji: 'Segoe UI Emoji, Noto Color Emoji', fallback: 'Consolas, NSimSun, Segoe UI Symbol',
  fontSize: 15, lineHeight: 1.35, scrollback: 50000, renderer: 'dom', unicode: '15-graphemes', cursorBlink: false, fontPresetVersion: 2,uiTheme:'midnight',terminalScheme:'auto'
};
const ranges = {
  Latin: 'U+0000-024F,U+1E00-1EFF',
  CJK: 'U+2E80-2FFF,U+3000-303F,U+3040-30FF,U+3100-312F,U+31A0-31BF,U+31F0-31FF,U+3400-4DBF,U+4E00-9FFF,U+AC00-D7AF,U+F900-FAFF,U+FE30-FE4F,U+FF00-FFEF,U+20000-323AF',
  Math: 'U+0370-03FF,U+1F00-1FFF,U+2100-214F,U+2190-22FF,U+2308-230B,U+27C0-2AFF,U+1D400-1D7FF',
  Emoji: 'U+200D,U+20E3,U+231A-231B,U+2328,U+23CF,U+23E9-23F3,U+23F8-23FA,U+2600-27BF,U+FE0E-FE0F,U+1F000-1FAFF,U+E0020-E007F'
};
export function families(value) { return String(value).split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean).slice(0, 12); }
export function fontCSS(options, adjustments = {}) {
  let css = '';
  const aliases = [];
  for (const [group, key] of [['Latin','latin'], ['CJK','cjk'], ['Math','math'], ['Emoji','emoji']]) {
    families(options[key]).forEach((font, i) => {
      const alias = `Silk${group}${i}`; aliases.push(`"${alias}"`);
      // JSON quoting prevents user font names from injecting CSS declarations.
      const scale = adjustments[alias];
      css += `@font-face{font-family:"${alias}";src:local(${JSON.stringify(font)});unicode-range:${ranges[group]};font-display:swap;${scale ? `size-adjust:${scale * 100}%;` : ''}}\n`;
    });
  }
  const family = [...aliases, ...families(options.fallback).map(x => JSON.stringify(x)), 'monospace'].join(',');
  return { css, family };
}
export async function calibrateFonts(options, style) {
  const raw = fontCSS(options); style.textContent = raw.css;
  const ctx = document.createElement('canvas').getContext('2d');
  const samples = { Latin:'W', CJK:'中', Math:'α', Emoji:'🥳' }, loaded = {}, adjustments = {};
  await Promise.all(Object.entries(samples).flatMap(([group, sample]) => families(options[group === 'CJK' ? 'cjk' : group.toLowerCase()]).map(async (_, i) => {
    const alias = `Silk${group}${i}`;
    try { loaded[alias] = (await document.fonts.load(`${options.fontSize}px "${alias}"`, sample)).length > 0; } catch { loaded[alias] = false; }
  })));
  ctx.font = `${options.fontSize}px ${raw.family}`; const cellWidth = ctx.measureText('W').width;
  for (const [group, sample] of Object.entries(samples)) {
    if (group === 'Latin') continue;
    const key = group === 'CJK' ? 'cjk' : group.toLowerCase();
    families(options[key]).forEach((_, i) => {
      const alias = `Silk${group}${i}`; if (!loaded[alias]) return;
      ctx.font = `${options.fontSize}px "${alias}"`;
      const width = ctx.measureText(sample).width;
      if (width > 0) adjustments[alias] = cellWidth * (group === 'Math' ? 1 : 2) / width;
    });
  }
  const calibrated = fontCSS(options, adjustments); style.textContent = calibrated.css;
  await Promise.all(Object.entries(loaded).filter(([, ok]) => ok).map(([alias]) => document.fonts.load(`${options.fontSize}px "${alias}"`, samples[alias.match(/^Silk(\D+)/)[1]]).catch(() => {})));
  return { ...calibrated, cellWidth, loaded, adjustments };
}
export function sanitizeOptions(input) {
  const o = { ...defaults };
  if(input?.uiTheme==='system'||Object.hasOwn(uiThemes,input?.uiTheme))o.uiTheme=input.uiTheme;
  if(input?.terminalScheme==='auto'||Object.hasOwn(terminalSchemes,input?.terminalScheme))o.terminalScheme=input.terminalScheme;
  for (const k of ['latin','cjk','math','emoji','fallback']) if (typeof input?.[k] === 'string' && input[k].length < 1000) o[k] = input[k];
  if (input?.fontPresetVersion !== 2) { o.latin = defaults.latin; o.cjk = defaults.cjk; }
  for (const [k, min, max] of [['fontSize',10,32], ['lineHeight',1,1.8], ['scrollback',1000,500000]]) {
    const n = Number(input?.[k]); if (Number.isFinite(n) && n >= min && n <= max) o[k] = k === 'lineHeight' ? n : Math.round(n);
  }
  o.renderer = input?.renderer === 'webgl' ? 'webgl' : 'dom'; o.unicode = input?.unicode === '11' ? '11' : '15-graphemes'; o.cursorBlink = input?.cursorBlink === true; return o;
}
