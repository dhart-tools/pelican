import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { ILLMCompleteOptions, ILLMMessage, ILLMProvider, LLMProviderError } from './provider';

const MAX_BUFFER = 1024 * 1024;

interface ICopilotRunOptions {
  cwd: string;
  timeoutMs?: number;
}

interface ICopilotRunResult {
  stdout: string;
  stderr: string;
}

export type CopilotRunner = (
  args: string[],
  options: ICopilotRunOptions,
) => Promise<ICopilotRunResult>;

const defaultRunner: CopilotRunner = (args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      'copilot',
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        killSignal: 'SIGTERM',
        maxBuffer: MAX_BUFFER,
        encoding: 'utf-8',
        env: {
          ...process.env,
          COPILOT_AUTO_UPDATE: 'false',
          GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: 'false',
          GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: 'false',
          GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: 'false',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });

function buildPrompt(messages: ILLMMessage[]): string {
  return messages
    .map(({ role, content }) => `[${role.toUpperCase()} MESSAGE]\n${content}`)
    .join('\n\n');
}

function processError(err: unknown, timeoutMs?: number): LLMProviderError {
  const processErr = err as Error & {
    code?: string;
    killed?: boolean;
    stderr?: string;
  };
  if (processErr?.code === 'ENOENT') {
    return new LLMProviderError(
      'GitHub Copilot CLI is not installed — run `pelican setup` or `npm install -g @github/copilot`.',
      err,
    );
  }
  if (processErr?.killed) {
    return new LLMProviderError(`GitHub Copilot CLI timed out after ${timeoutMs}ms.`, err);
  }

  const stderr = processErr?.stderr?.trim().slice(0, 300);
  const loginHint = /auth|login|sign in/i.test(stderr || processErr?.message || '')
    ? ' Run `copilot login` and try again.'
    : '';
  return new LLMProviderError(
    `GitHub Copilot CLI failed${stderr ? `: ${stderr}` : `: ${String(err)}`}.${loginHint}`,
    err,
  );
}

/**
 * Text-only GitHub Copilot CLI adapter. Pelican supplies all context in the
 * prompt, so the process runs outside the repository with instructions,
 * built-in/workspace MCP integrations, auto-update, and usable tools disabled.
 */
export class CopilotProvider implements ILLMProvider {
  readonly id = 'copilot';

  constructor(private readonly runner: CopilotRunner = defaultRunner) {}

  async complete(messages: ILLMMessage[], opts: ILLMCompleteOptions = {}): Promise<string> {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'pelican-copilot-'));
    try {
      const { stdout } = await this.runner(
        [
          '-p',
          buildPrompt(messages),
          '-s',
          '--no-auto-update',
          '--no-color',
          '--no-custom-instructions',
          '--disable-builtin-mcps',
          '--available-tools=ask_user',
          '--no-ask-user',
        ],
        { cwd, timeoutMs: opts.timeoutMs },
      );
      const content = stdout.trim();
      if (!content) throw new LLMProviderError('GitHub Copilot CLI returned an empty response.');
      return content;
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      throw processError(err, opts.timeoutMs);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  }
}
