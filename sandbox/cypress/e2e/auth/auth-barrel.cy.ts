// SCENARIO 8 test — imports through the auth barrel, not the concrete file.
// Expected: editing LoginForm.tsx still credits this test via DirectImportScorer
// after the barrel walker resolves the re-export.

import { LoginForm } from '../../../src/components/auth';

describe('Auth barrel smoke', () => {
  it('LoginForm component is exported through the barrel', () => {
    expect(typeof LoginForm).to.eq('function');
  });
});
