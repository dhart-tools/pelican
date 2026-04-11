// RouteMatchScorer — route /register maps to RegisterPage

import { useNavigate } from 'react-router-dom';
import { RegisterForm } from '../components/auth/RegisterForm';

export function RegisterPage() {
  const navigate = useNavigate();
  return (
    <main>
      <RegisterForm onSuccess={() => navigate('/login')} />
    </main>
  );
}
