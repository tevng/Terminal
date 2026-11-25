const defaultLocale = 'en';
const catalogs = {
  en: require('./en.json'),
  'zh-CN': require('./zh-CN.json')
};
const locales = Object.keys(catalogs);

function normalizeLocale(locale) {
  return locales.includes(locale) ? locale : defaultLocale;
}

function translate(locale, key, values = {}) {
  const catalog = catalogs[normalizeLocale(locale)];
  const fallback = catalogs[defaultLocale];
  const message = Object.hasOwn(catalog, key) ? catalog[key] : Object.hasOwn(fallback, key) ? fallback[key] : key;
  return message.replace(/\{(\w+)\}/g, (placeholder, name) => Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}

const english = (key, values) => translate(defaultLocale, key, values);

module.exports = { defaultLocale, locales, normalizeLocale, translate, english };
