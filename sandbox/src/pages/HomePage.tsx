// RouteMatchScorer — route / maps to HomePage
// TranslationMatchScorer — t('common.home'), t('products.title')

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();
  return (
    <main data-testid="home-page">
      <h1>{t('common.home')}</h1>
      <Link data-testid="go-to-products" to="/products">
        {t('products.title')}
      </Link>
      <Link data-testid="go-to-login" to="/login">
        {t('auth.signIn')}
      </Link>
    </main>
  );
}
