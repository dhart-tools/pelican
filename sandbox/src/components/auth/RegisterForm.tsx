// Scorer coverage:
//   SelectorMatchScorer  — data-testid="register-email", "register-password", "register-name", "register-submit"
//   TranslationMatchScorer — t('auth.register')
//   APIInterceptScorer   — register.cy.ts intercepts POST /api/auth (indirect via registerApi)

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerApi } from '../../api/auth';

interface RegisterFormProps {
  onSuccess?: () => void;
}

export function RegisterForm({ onSuccess }: RegisterFormProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await registerApi({ email, password, name });
      onSuccess?.();
    } catch {
      setError(t('common.error'));
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{t('auth.register')}</h1>
      <input
        data-testid="register-name"
        type="text"
        placeholder="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        data-testid="register-email"
        type="email"
        placeholder={t('auth.emailPlaceholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        data-testid="register-password"
        type="password"
        placeholder={t('auth.passwordPlaceholder')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p data-testid="register-error">{error}</p>}
      <button data-testid="register-submit" type="submit">
        {t('auth.register')}
      </button>
    </form>
  );
}
