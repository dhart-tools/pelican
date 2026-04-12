// RouteMatchScorer — route /login maps to LoginPage
// LoginPage renders LoginForm, so changing LoginForm → route scorer fires

import { useNavigate } from 'react-router-dom';
import { LoginForm } from '../components/auth/LoginForm';

export function LoginPage() {
  const navigate = useNavigate();
  return (
    <main>
      <LoginForm onSuccess={() => navigate('/products')} />
    </main>
  );
}
