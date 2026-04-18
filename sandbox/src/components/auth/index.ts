// SCENARIO 8: barrel re-export — probes Phase 2 symbol-resolved walker.
// Test imports from this barrel; pelican should still credit LoginForm/RegisterForm.

export { LoginForm } from './LoginForm';
export { RegisterForm } from './RegisterForm';
