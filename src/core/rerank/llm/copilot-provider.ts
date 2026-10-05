import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { CopilotClient, CopilotClientOptions, SessionConfig } from '@github/copilot-sdk';

import { ILLMCompleteOptions, ILLMMessage, ILLMProvider, LLMProviderError } from './provider';

interface ICopilotSession {
  readonly sessionId: string;
  sendAndWait(
    options: { prompt: string },
    timeout?: number,
  ): Promise<{ data: { content: string } } | undefined>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

interface ICopilotClient {
  start(): Promise<void>;
  getAuthStatus(): Promise<{ isAuthenticated: boolean; statusMessage?: string }>;
  createSession(config: SessionConfig): Promise<ICopilotSession>;
  deleteSession(sessionId: string): Promise<void>;
  stop(): Promise<Error[]>;
  forceStop(): Promise<void>;
}

type CopilotClientFactory = (options: CopilotClientOptions) => ICopilotClient;

export interface ICopilotProviderOptions {
  model?: string;
  clientFactory?: CopilotClientFactory;
}

interface IStartedClient {
  client: ICopilotClient;
  directory: string;
}

function splitMessages(messages: ILLMMessage[]): { systemMessage: string; prompt: string } {
  return {
    systemMessage: messages
      .filter(({ role }) => role === 'system')
      .map(({ content }) => content)
      .join('\n\n'),
    prompt: messages
      .filter(({ role }) => role === 'user')
      .map(({ content }) => content)
      .join('\n\n'),
  };
}

function processError(err: unknown, timeoutMs?: number): LLMProviderError {
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(message)) {
    return new LLMProviderError(`GitHub Copilot SDK timed out after ${timeoutMs}ms.`, err);
  }
  const loginHint = /auth|oauth|login|sign in|token/i.test(message)
    ? ' Run `copilot login` and try again.'
    : '';
  return new LLMProviderError(`GitHub Copilot SDK failed: ${message}.${loginHint}`, err);
}

/**
 * Text-only GitHub Copilot SDK adapter. One client/runtime is shared across the
 * rerank pass; each completion gets an isolated session with no tools or repo
 * access so candidate judgments cannot affect one another.
 */
export class CopilotProvider implements ILLMProvider {
  readonly id = 'copilot';
  private readonly model: string;
  private readonly clientFactory: CopilotClientFactory;
  private clientPromise?: Promise<IStartedClient>;

  constructor(options: ICopilotProviderOptions = {}) {
    this.model = options.model ?? 'auto';
    this.clientFactory =
      options.clientFactory ?? ((clientOptions) => new CopilotClient(clientOptions));
  }

  async complete(messages: ILLMMessage[], opts: ILLMCompleteOptions = {}): Promise<string> {
    let session: ICopilotSession | undefined;
    let client: ICopilotClient | undefined;
    try {
      const started = await this.getClient();
      client = started.client;
      const { systemMessage, prompt } = splitMessages(messages);
      session = await client.createSession({
        model: this.model,
        workingDirectory: started.directory,
        configDirectory: started.directory,
        enableConfigDiscovery: false,
        availableTools: [],
        tools: [],
        mcpServers: {},
        customAgents: [],
        skillDirectories: [],
        includedBuiltinSkills: [],
        systemMessage: { mode: 'replace', content: systemMessage },
      });
      const response = await session.sendAndWait({ prompt }, opts.timeoutMs);
      const content = response?.data.content.trim();
      if (!content) throw new LLMProviderError('GitHub Copilot SDK returned an empty response.');
      return content;
    } catch (err) {
      if (session && err instanceof Error && /timeout/i.test(err.message)) {
        await session.abort().catch(() => undefined);
      }
      if (err instanceof LLMProviderError) throw err;
      throw processError(err, opts.timeoutMs);
    } finally {
      if (session && client) {
        const sessionId = session.sessionId;
        await session.disconnect().catch(() => undefined);
        await client.deleteSession(sessionId).catch(() => undefined);
      }
    }
  }

  async dispose(): Promise<void> {
    const pending = this.clientPromise;
    this.clientPromise = undefined;
    if (!pending) return;

    let started: IStartedClient | undefined;
    try {
      started = await pending;
      const errors = await started.client.stop();
      if (errors.length > 0) await started.client.forceStop();
    } catch {
      await started?.client.forceStop().catch(() => undefined);
    } finally {
      if (started) await fs.rm(started.directory, { recursive: true, force: true });
    }
  }

  private getClient(): Promise<IStartedClient> {
    this.clientPromise ??= this.startClient();
    return this.clientPromise;
  }

  private async startClient(): Promise<IStartedClient> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pelican-copilot-'));
    const client = this.clientFactory({
      workingDirectory: directory,
      useLoggedInUser: true,
      logLevel: 'error',
    });
    try {
      await client.start();
      const auth = await client.getAuthStatus();
      if (!auth.isAuthenticated) {
        throw new LLMProviderError(
          `GitHub Copilot is not authenticated${auth.statusMessage ? `: ${auth.statusMessage}` : ''}. Run \`copilot login\` and try again.`,
        );
      }
      return { client, directory };
    } catch (err) {
      await client.stop().catch(() => []);
      await fs.rm(directory, { recursive: true, force: true });
      throw err;
    }
  }
}
