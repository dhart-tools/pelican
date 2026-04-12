// i18n analyzer target — localesPath: "public/locales"
// TranslationMatchScorer reads the key→text index built from public/locales/en/translation.json

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['translation'],
  defaultNS: 'translation',
  backend: { loadPath: '/locales/{{lng}}/{{ns}}.json' },
  interpolation: { escapeValue: false },
});

export default i18n;
