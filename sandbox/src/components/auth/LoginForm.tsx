// Scorer coverage:
//   SelectorMatchScorer  — data-testid="email-input", "password-input", "login-submit"
//   SelectorIdMatchScorer — id="login-form"
//   TranslationMatchScorer — t('auth.signIn'), t('auth.loginTitle')
//   DirectImportScorer   — login.cy.ts imports LoginForm directly
//   FilenameConventionScorer — LoginForm ↔ login.cy.ts (normalized: "loginform" vs "login" — no match, intentional LOW case demo)

import { useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";
import { loginUser, setAuthError, setAuthLoading } from "../../store/authSlice";
import { loginApi } from "../../api/auth";
import type { AppDispatch } from "../../store";

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    dispatch(setAuthLoading(true));
    try {
      const user = await loginApi({ email, password });
      dispatch(loginUser(user));
      onSuccess?.();
    } catch {
      dispatch(setAuthError(t("auth.loginError")));
    }
  }

  return (
    <form id="login-form" onSubmit={handleSubmit}>
      <h1>{t("auth.loginTitle")}</h1>
      <input
        data-testid="email-input"
        type="email"
        placeholder={t("auth.emailPlaceholder")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        data-testid="password-input"
        type="password"
        placeholder={t("auth.passwordPlaceholder")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button data-testid="login-submit" type="submit">
        {t("auth.signIn")}
      </button>
      <a href="/register">{t("auth.noAccount")}</a>
      <div>{t("auth.forgotPassword")}</div>
    </form>
  );
}
