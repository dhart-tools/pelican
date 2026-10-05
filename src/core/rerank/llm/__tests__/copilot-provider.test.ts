import * as fs from 'fs';

import { CopilotProvider } from '@/core/rerank/llm/copilot-provider';
import { LLMProviderError } from '@/core/rerank/llm/provider';

const messages = [
  { role: 'system' as const, content: 'Return JSON only.' },
  { role: 'user' as const, content: 'Judge this candidate.' },
];

function createSdkMocks() {
  const session = {
    sessionId: 'session-1',
    sendAndWait: jest.fn(
      async (): Promise<{ data: { content: string } } | undefined> => ({
        data: { content: '  {"relevant":true}\n' },
      }),
    ),
    abort: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
  };
  const client = {
    start: jest.fn(async () => undefined),
    getAuthStatus: jest.fn(
      async (): Promise<{ isAuthenticated: boolean; statusMessage?: string }> => ({
        isAuthenticated: true,
      }),
    ),
    createSession: jest.fn(async () => session),
    deleteSession: jest.fn(async () => undefined),
    stop: jest.fn(async () => [] as Error[]),
    forceStop: jest.fn(async () => undefined),
  };
  return { client, session };
}

describe('CopilotProvider', () => {
  it('uses one isolated SDK client and a tool-free session per completion', async () => {
    const { client, session } = createSdkMocks();
    let clientDirectory = '';
    const provider = new CopilotProvider({
      model: 'claude-haiku-4.5',
      clientFactory: (options) => {
        clientDirectory = options.workingDirectory ?? '';
        expect(fs.existsSync(clientDirectory)).toBe(true);
        expect(options).toEqual(
          expect.objectContaining({
            useLoggedInUser: true,
            logLevel: 'error',
          }),
        );
        return client;
      },
    });

    await expect(provider.complete(messages, { timeoutMs: 1234 })).resolves.toBe(
      '{"relevant":true}',
    );
    await expect(provider.complete(messages, { timeoutMs: 1234 })).resolves.toBe(
      '{"relevant":true}',
    );

    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.getAuthStatus).toHaveBeenCalledTimes(1);
    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(client.createSession).toHaveBeenCalledWith({
      model: 'claude-haiku-4.5',
      workingDirectory: clientDirectory,
      configDirectory: clientDirectory,
      enableConfigDiscovery: false,
      availableTools: [],
      tools: [],
      mcpServers: {},
      customAgents: [],
      skillDirectories: [],
      includedBuiltinSkills: [],
      systemMessage: { mode: 'replace', content: 'Return JSON only.' },
    });
    expect(session.sendAndWait).toHaveBeenCalledWith({ prompt: 'Judge this candidate.' }, 1234);
    expect(session.disconnect).toHaveBeenCalledTimes(2);
    expect(client.deleteSession).toHaveBeenCalledTimes(2);

    await provider.dispose();
    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(clientDirectory)).toBe(false);
  });

  it('aborts a timed-out session before cleaning it up', async () => {
    const { client, session } = createSdkMocks();
    session.sendAndWait.mockRejectedValueOnce(new Error('Timeout after 500ms'));
    const provider = new CopilotProvider({ clientFactory: () => client });

    await expect(provider.complete(messages, { timeoutMs: 500 })).rejects.toEqual(
      expect.objectContaining<Partial<LLMProviderError>>({
        message: expect.stringContaining('timed out after 500ms'),
      }),
    );
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledWith('session-1');
    await provider.dispose();
  });

  it('rejects an empty response and still cleans up the session', async () => {
    const { client, session } = createSdkMocks();
    session.sendAndWait.mockResolvedValueOnce(undefined);
    const provider = new CopilotProvider({ clientFactory: () => client });

    await expect(provider.complete(messages)).rejects.toThrow(/empty response/);
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledTimes(1);
    await provider.dispose();
  });

  it('turns a missing login into an actionable provider error', async () => {
    const { client } = createSdkMocks();
    client.getAuthStatus.mockResolvedValueOnce({
      isAuthenticated: false,
      statusMessage: 'No GitHub OAuth token provided',
    });
    const provider = new CopilotProvider({ clientFactory: () => client });

    await expect(provider.complete(messages)).rejects.toThrow(/copilot login/);
    expect(client.stop).toHaveBeenCalledTimes(1);
    await provider.dispose();
  });

  it('force-stops the SDK runtime when graceful cleanup reports errors', async () => {
    const { client } = createSdkMocks();
    client.stop.mockResolvedValueOnce([new Error('cleanup failed')]);
    const provider = new CopilotProvider({ clientFactory: () => client });

    await provider.complete(messages);
    await provider.dispose();

    expect(client.forceStop).toHaveBeenCalledTimes(1);
  });
});
