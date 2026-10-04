import * as fs from 'fs';

import { CopilotProvider, CopilotRunner } from '@/core/rerank/llm/copilot-provider';
import { LLMProviderError } from '@/core/rerank/llm/provider';

const messages = [
  { role: 'system' as const, content: 'Return JSON only.' },
  { role: 'user' as const, content: 'Judge this diff: $(touch should-not-run)' },
];

describe('CopilotProvider', () => {
  it('runs an isolated text-only prompt and removes its temporary directory', async () => {
    let workingDirectory = '';
    const runner: CopilotRunner = async (args, options) => {
      workingDirectory = options.cwd;
      expect(fs.existsSync(workingDirectory)).toBe(true);
      expect(args).toEqual([
        '-p',
        '[SYSTEM MESSAGE]\nReturn JSON only.\n\n[USER MESSAGE]\nJudge this diff: $(touch should-not-run)',
        '-s',
        '--model=claude-sonnet-4.6',
        '--no-auto-update',
        '--no-color',
        '--no-custom-instructions',
        '--disable-builtin-mcps',
        '--available-tools=ask_user',
        '--no-ask-user',
      ]);
      expect(options.timeoutMs).toBe(1234);
      return { stdout: '  {"relevant":true}\n', stderr: '' };
    };

    const provider = new CopilotProvider({ model: 'claude-sonnet-4.6', runner });
    await expect(provider.complete(messages, { timeoutMs: 1234 })).resolves.toBe(
      '{"relevant":true}',
    );
    expect(fs.existsSync(workingDirectory)).toBe(false);
  });

  it('rejects an empty response and still removes its temporary directory', async () => {
    let workingDirectory = '';
    const provider = new CopilotProvider({
      runner: async (_args, options) => {
        workingDirectory = options.cwd;
        return { stdout: '  ', stderr: '' };
      },
    });

    await expect(provider.complete(messages)).rejects.toThrow(/empty response/);
    expect(fs.existsSync(workingDirectory)).toBe(false);
  });

  it('turns a missing executable into an actionable provider error', async () => {
    const provider = new CopilotProvider({
      runner: async () => {
        throw Object.assign(new Error('spawn copilot ENOENT'), { code: 'ENOENT' });
      },
    });

    await expect(provider.complete(messages)).rejects.toThrow(/npm install -g @github\/copilot/);
  });

  it('adds a login hint to authentication failures', async () => {
    const provider = new CopilotProvider({
      runner: async () => {
        throw Object.assign(new Error('exit 1'), { stderr: 'Not authenticated' });
      },
    });

    await expect(provider.complete(messages)).rejects.toThrow(/copilot login/);
  });

  it('adds a login hint when authentication failure is only in the error message', async () => {
    const provider = new CopilotProvider({
      runner: async () => {
        throw Object.assign(new Error('Login required'), { stderr: '' });
      },
    });

    await expect(provider.complete(messages)).rejects.toThrow(/copilot login/);
  });

  it('reports a killed process as a timeout', async () => {
    const provider = new CopilotProvider({
      runner: async () => {
        throw Object.assign(new Error('killed'), { killed: true });
      },
    });

    await expect(provider.complete(messages, { timeoutMs: 500 })).rejects.toEqual(
      expect.objectContaining<Partial<LLMProviderError>>({
        message: expect.stringContaining('timed out after 500ms'),
      }),
    );
  });
});
