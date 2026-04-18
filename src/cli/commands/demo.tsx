import * as fs from 'fs/promises';

import { Command } from 'commander';
import { render, Box, Text, useInput, useApp } from 'ink';
import React, { useState, useEffect, useCallback } from 'react';

import { Header } from '@/cli/components/Header';
import { Panel } from '@/cli/components/Panel';
import { ResultsTable } from '@/cli/components/ResultsTable';
import { SectionDivider } from '@/cli/components/SectionDivider';
import { StatusStep } from '@/cli/components/StatusStep';
import { loadProjectConfig, toScoringConfig } from '@/cli/config-loader';
import { palette } from '@/cli/theme';
import { loadTheme } from '@/cli/user-config';
import { Registry } from '@/core/registry/registry';
import { RegistryBuilder } from '@/core/registry/registry-builder';
import { ActionTypeScorer } from '@/core/scoring/scorers/action-type-scorer';
import { APIInterceptScorer } from '@/core/scoring/scorers/api-intercept-scorer';
import { ColocationScorer } from '@/core/scoring/scorers/colocation-scorer';
import { DependentSelectorScorer } from '@/core/scoring/scorers/dependent-selector-scorer';
import { DescribeBlockScorer } from '@/core/scoring/scorers/describe-block-scorer';
import { DirectImportScorer } from '@/core/scoring/scorers/direct-import-scorer';
import { FilenameConventionScorer } from '@/core/scoring/scorers/filename-convention-scorer';
import { ReduxChainScorer } from '@/core/scoring/scorers/redux-chain-scorer';
import { ReduxConsumerScorer } from '@/core/scoring/scorers/redux-consumer-scorer';
import { RouteMatchScorer } from '@/core/scoring/scorers/route-match-scorer';
import { SelectorIdMatchScorer } from '@/core/scoring/scorers/selector-id-match-scorer';
import { SelectorMatchScorer } from '@/core/scoring/scorers/selector-match-scorer';
import { TransitiveImportScorer } from '@/core/scoring/scorers/transitive-import-scorer';
import { TranslationMatchScorer } from '@/core/scoring/scorers/translation-match-scorer';
import { UsageSiteScorer } from '@/core/scoring/scorers/usage-site-scorer';
import { ScoringEngine } from '@/core/scoring/scoring-engine';
import { IScoreResult } from '@/types/scorers';

// ─── Percy Pixel-Art Mascot ───────────────────────────────────────────────────
// 10×12 front-facing baby pelican.
// T=teal body  W=white eye  B=dark pupil  Y=amber beak/pouch/feet  _=transparent

type PixelCell = 'T' | 'W' | 'B' | 'Y' | null;
const T: PixelCell = 'T',
  W: PixelCell = 'W',
  B: PixelCell = 'B',
  Y: PixelCell = 'Y',
  _: PixelCell = null;

const PERCY_GRID: PixelCell[][] = [
  //      0  1  2  3  4  5  6
  /* head  */ [_, T, T, T, T, T, _],
  /* eyes  */ [T, W, W, T, W, W, T], // whites span almost full width
  /* pupils*/ [T, W, B, T, W, B, T], // shine left, pupil right → looking straight
  /* cheeks*/ [T, T, T, T, T, T, T],
  /* beak  */ [_, T, Y, Y, Y, T, _],
  /* pouch */ [T, Y, Y, Y, Y, Y, T], // golden pouch — widest point
  /* base  */ [_, T, Y, Y, Y, T, _],
  /* feet  */ [_, _, Y, _, Y, _, _], // tiny amber toes
];

// ─── Types ────────────────────────────────────────────────────────────────────

type DemoStage = 'splash' | 'story' | 'detect' | 'build' | 'ex1' | 'ex2' | 'ex3' | 'fin';

interface DetectedFramework {
  name: string;
  detail: string;
  found: boolean;
}
interface BuildStats {
  sourceFiles: number;
  testFiles: number;
  dependencies: number;
  selectors: number;
  routes: number;
  duration: number;
}
interface Example {
  file: string;
  setup: string;
  reaction: string;
  results: Array<{ changedFile: string; suggestedTests: IScoreResult[] }>;
  done: boolean;
}

interface DemoState {
  stage: DemoStage;
  typed: number;
  ready: boolean;
  working: boolean;

  frameworks: DetectedFramework[];
  detectDone: boolean;

  buildPhase: string;
  buildStats: BuildStats | null;
  registry: Registry | null;

  examples: [Example, Example, Example];
  reacting: boolean; // showing reaction dialogue instead of setup
  reactTyped: number;

  error: string | null;
}

// ─── Stage order ──────────────────────────────────────────────────────────────

const STAGE_ORDER: DemoStage[] = ['splash', 'story', 'detect', 'build', 'ex1', 'ex2', 'ex3', 'fin'];

// ─── Dialogues ────────────────────────────────────────────────────────────────

const SETUP: Record<DemoStage, string> = {
  splash: `Hi! I'm Percy 👋\nI'm going to show you exactly what Pelican can do.`,
  story:
    `It's 4:47 PM on a Thursday.\n` +
    `You changed one file. CI just woke up and queued 400 Cypress tests.\n\n` +
    `You and I both know only a handful of them matter.\n\n` +
    `I'm Percy. I find the ones that matter.\n` +
    `No runtime. No coverage tricks. Just static analysis.\n\n` +
    `Let me show you exactly what I mean.`,
  detect:
    `First, let me look around this project.\n` +
    `Every framework I detect is another class of signals I can use.`,
  build:
    `Now I map everything.\n\n` +
    `Every source file, every import edge, every selector,\n` +
    `route, translation key, and Redux chain — all indexed.\n\n` +
    `This runs once. Everything after is instant.`,
  ex1:
    `Scenario 1.\n\n` +
    `Someone touched src/api/auth.ts —\n` +
    `login, logout, register all live in this file.\n\n` +
    `Which Cypress tests intercept those endpoints?`,
  ex2:
    `Scenario 2.\n\n` +
    `LoginForm.tsx just got a prop change.\n` +
    `It owns [data-testid="login-submit"] and #login-form.\n\n` +
    `Who selects those exact elements in Cypress?`,
  ex3:
    `Scenario 3.\n\n` +
    `products.ts. The API layer for the product catalogue.\n` +
    `Two independent signals fired for this one.\n\n` +
    `Let's see what they found.`,
  fin:
    `Three files. Three different signal types.\n\n` +
    `API intercepts. DOM selectors. Filename patterns.\n` +
    `All of them pointing at the right tests — no overlap,\n` +
    `no noise, no 400-test runs for a one-line change.\n\n` +
    `That's Pelican. Ship it.\n\n` +
    `— Percy 🦅`,
};

const REACTION: Partial<Record<DemoStage, string>> = {
  detect:
    `Four signals active. Cypress intercepts, Redux chains,\n` +
    `route maps, and i18n keys — I'll use all of them.`,
  build: `Done. I know this codebase inside out now.`,
  ex1:
    `Three tests declared they own /api/auth/*.\n` +
    `They put it right there in cy.intercept — no guessing needed.`,
  ex2:
    `High confidence on both. They check the exact same\n` +
    `selectors that exist in the component. Zero doubt.`,
  ex3:
    `Two signals fired independently and agreed.\n` +
    `When filename AND intercept both point at the same test — trust it.`,
};

const HINTS: Record<DemoStage, string> = {
  splash: 'press  ENTER  to begin',
  story: 'press  ENTER  to scan the project',
  detect: 'press  ENTER  to build the graph',
  build: 'press  ENTER  for scenario 1',
  ex1: 'press  ENTER  for scenario 2',
  ex2: 'press  ENTER  for scenario 3',
  ex3: 'press  ENTER  to finish',
  fin: 'press  ENTER  to exit',
};

const STAGE_LABELS: Record<DemoStage, string> = {
  splash: '1 / 8',
  story: '2 / 8',
  detect: '3 / 8',
  build: '4 / 8',
  ex1: '5 / 8',
  ex2: '6 / 8',
  ex3: '7 / 8',
  fin: '8 / 8',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function silenceConsole() {
  const log = console.log,
    warn = console.warn,
    error = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => {
    console.log = log;
    console.warn = warn;
    console.error = error;
  };
}

function makeExample(file: string, setup: string, reaction: string): Example {
  return { file, setup, reaction, results: [], done: false };
}

// ─── Components ───────────────────────────────────────────────────────────────

function PercyArt() {
  const colorMap: Record<string, string> = {
    T: palette.brand, // teal body
    W: '#ECFEFF', // bright white eye
    B: '#083344', // dark navy pupil
    Y: palette.amber, // golden beak, pouch, feet
  };
  return (
    <Box flexDirection="column" marginBottom={1}>
      {PERCY_GRID.map((row, ri) => (
        <Box key={ri}>
          {row.map((cell, ci) =>
            cell === null ? (
              <Text key={ci}>{'  '}</Text>
            ) : (
              <Text key={ci} backgroundColor={colorMap[cell]}>
                {'  '}
              </Text>
            ),
          )}
        </Box>
      ))}
    </Box>
  );
}

function PercyBox({
  text,
  typed,
  inline = false,
}: {
  text: string;
  typed: number;
  inline?: boolean;
}) {
  const visible = text.slice(0, typed).split('\n');
  return (
    <Box flexDirection="column" marginTop={inline ? 0 : 1} marginBottom={1}>
      <Box alignItems="flex-start">
        {!inline && (
          <Text color={palette.brand} bold>
            {'  '}
          </Text>
        )}
        <Box flexDirection="column">
          {visible.map((line, i) => (
            <Text key={i} color={palette.text}>
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function FrameworkRow({ f, visible }: { f: DetectedFramework; visible: boolean }) {
  if (!visible) return null;
  return (
    <Box>
      <Text color={f.found ? palette.emerald : palette.muted} bold>
        {f.found ? '✔' : '○'}
      </Text>
      <Text>{'  '}</Text>
      <Text color={f.found ? palette.text : palette.muted} bold={f.found}>
        {f.name.padEnd(22)}
      </Text>
      <Text color={palette.dim}>{f.detail}</Text>
    </Box>
  );
}

function BuildProgress({ phase, stats }: { phase: string; stats: BuildStats | null }) {
  const phases = [
    'scanning',
    'extracting-source',
    'extracting-tests',
    'building-indexes',
    'saving',
  ];
  const labels: Record<string, string> = {
    scanning: 'scanning files',
    'extracting-source': 'extracting source',
    'extracting-tests': 'extracting tests',
    'building-indexes': 'building indexes',
    saving: 'saving registry',
  };
  function stepStatus(s: string) {
    if (stats) return 'success' as const;
    const si = phases.indexOf(s),
      ci = phases.indexOf(phase);
    if (si < ci) return 'success' as const;
    if (si === ci) return 'loading' as const;
    return 'idle' as const;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      {phases.map((p) => (
        <StatusStep key={p} status={stepStatus(p)} label={labels[p]} />
      ))}
      {stats && (
        <Box marginTop={1}>
          {(
            [
              ['source', stats.sourceFiles],
              ['tests', stats.testFiles],
              ['deps', stats.dependencies],
              ['selectors', stats.selectors],
              ['routes', stats.routes],
              ['time', `${(stats.duration / 1000).toFixed(1)}s`],
            ] as [string, string | number][]
          ).map(([l, v]) => (
            <Box key={l} marginRight={4} flexDirection="column">
              <Text color={palette.dim}>{l}</Text>
              <Text color={palette.text} bold>
                {String(v)}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function ExampleSection({
  ex,
  reacting,
  reactTyped,
}: {
  ex: Example;
  reacting: boolean;
  reactTyped: number;
}) {
  return (
    <Box flexDirection="column">
      <SectionDivider label={`analyzing  ${ex.file}`} />
      {!ex.done && (
        <Box marginTop={1}>
          <Text color={palette.brand} bold>
            ◆{' '}
          </Text>
          <Text color={palette.dim}>scoring…</Text>
        </Box>
      )}
      {ex.done && <ResultsTable results={ex.results} maxResults={5} />}
      {reacting && (
        <Box flexDirection="column" marginTop={1}>
          <SectionDivider />
          <PercyBox text={ex.reaction} typed={reactTyped} inline />
        </Box>
      )}
    </Box>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function DemoApp() {
  const { exit } = useApp();

  const [state, setState] = useState<DemoState>({
    stage: 'splash',
    typed: 0,
    ready: false,
    working: false,
    frameworks: [],
    detectDone: false,
    buildPhase: 'scanning',
    buildStats: null,
    registry: null,
    examples: [
      makeExample('src/api/auth.ts', SETUP.ex1, REACTION.ex1!),
      makeExample('src/components/auth/LoginForm.tsx', SETUP.ex2, REACTION.ex2!),
      makeExample('src/api/products.ts', SETUP.ex3, REACTION.ex3!),
    ],
    reacting: false,
    reactTyped: 0,
    error: null,
  });

  // ── Typewriter ───────────────────────────────────────────────────────────────

  const dialogue = SETUP[state.stage] ?? '';

  useEffect(() => {
    if (state.reacting) return; // reaction has its own timer
    if (state.typed >= dialogue.length) {
      setState((s) => ({ ...s, ready: true }));
      return;
    }
    const isSplash = state.stage === 'splash';
    const id = setTimeout(
      () =>
        setState((s) => ({ ...s, typed: Math.min(s.typed + (isSplash ? 1 : 3), dialogue.length) })),
      isSplash ? 45 : 16,
    );
    return () => clearTimeout(id);
  }, [state.typed, dialogue.length, state.stage, state.reacting]);

  // ── Reaction typewriter ──────────────────────────────────────────────────────

  const currentExIdx =
    state.stage === 'ex1' ? 0 : state.stage === 'ex2' ? 1 : state.stage === 'ex3' ? 2 : -1;
  const currentEx = currentExIdx >= 0 ? state.examples[currentExIdx as 0 | 1 | 2] : null;
  const reactionText = currentEx?.reaction ?? REACTION[state.stage] ?? '';

  useEffect(() => {
    if (!state.reacting) return;
    if (state.reactTyped >= reactionText.length) {
      setState((s) => ({ ...s, ready: true }));
      return;
    }
    const id = setTimeout(
      () =>
        setState((s) => ({ ...s, reactTyped: Math.min(s.reactTyped + 3, reactionText.length) })),
      16,
    );
    return () => clearTimeout(id);
  }, [state.reacting, state.reactTyped, reactionText.length]);

  // ── Async workers ────────────────────────────────────────────────────────────

  const runAnalysis = useCallback(async (registry: Registry, file: string, idx: 0 | 1 | 2) => {
    const restore = silenceConsole();
    try {
      const config = await loadProjectConfig(undefined);
      const scoringConfig = toScoringConfig(config);
      const engine = new ScoringEngine(scoringConfig, registry);
      for (const scorer of [
        new DirectImportScorer(),
        new RouteMatchScorer(),
        new SelectorMatchScorer(),
        new TransitiveImportScorer(),
        new FilenameConventionScorer(),
        new ReduxChainScorer(),
        new ReduxConsumerScorer(),
        new TranslationMatchScorer(),
        new SelectorIdMatchScorer(),
        new APIInterceptScorer(),
        new ColocationScorer(),
        new DescribeBlockScorer(),
        new DependentSelectorScorer(),
        new ActionTypeScorer(),
        new UsageSiteScorer(),
      ]) {
        if (config.scoring.enabledScorers.includes(scorer.name)) engine.register(scorer);
      }
      const testFiles = registry.getFilesByType('test').map((f) => f.path);
      const scoreResults = engine
        .evaluateTests(file, testFiles)
        .filter((r) => r.score >= 0.4)
        .slice(0, 5);
      setState((s) => {
        const examples = [...s.examples] as [Example, Example, Example];
        examples[idx] = {
          ...examples[idx],
          results: [{ changedFile: file, suggestedTests: scoreResults }],
          done: true,
        };
        return { ...s, examples };
      });
    } finally {
      restore();
    }
  }, []);

  const runDetect = useCallback(async () => {
    setState((s) => ({ ...s, working: true }));
    const fws: DetectedFramework[] = [];
    try {
      const pkg = JSON.parse(await fs.readFile('package.json', 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      fws.push({ name: 'Cypress', detail: 'e2e testing framework', found: !!deps['cypress'] });
      fws.push({
        name: 'Redux Toolkit',
        detail: 'state management',
        found: !!deps['@reduxjs/toolkit'],
      });
      fws.push({
        name: 'React Router',
        detail: 'client-side routing',
        found: !!(deps['react-router-dom'] || deps['react-router']),
      });
      fws.push({
        name: 'react-i18next',
        detail: 'internationalization',
        found: !!(deps['react-i18next'] || deps['i18next']),
      });
    } catch {
      fws.push(
        { name: 'Cypress', detail: 'not detected', found: false },
        { name: 'Redux Toolkit', detail: 'not detected', found: false },
        { name: 'React Router', detail: 'not detected', found: false },
        { name: 'react-i18next', detail: 'not detected', found: false },
      );
    }
    for (let i = 0; i < fws.length; i++) {
      await new Promise<void>((r) => setTimeout(r, 250));
      setState((s) => ({ ...s, frameworks: fws.slice(0, i + 1) }));
    }
    setState((s) => ({ ...s, working: false, detectDone: true, reacting: true, reactTyped: 0 }));
  }, []);

  const runBuild = useCallback(async () => {
    setState((s) => ({ ...s, working: true, buildPhase: 'scanning' }));
    const restore = silenceConsole();
    try {
      const config = await loadProjectConfig(undefined);
      const phases = ['extracting-source', 'extracting-tests', 'building-indexes', 'saving'];
      let pi = 0;
      const timer = setInterval(() => {
        if (pi < phases.length - 1) setState((s) => ({ ...s, buildPhase: phases[++pi] }));
      }, 500);
      const start = Date.now();
      const builder = new RegistryBuilder();
      const iReg = await builder.buildFromDirectories({
        sourceDirs: config.sourceDirs,
        testPatterns: config.testPatterns,
        excludePatterns: config.excludePatterns,
        projectRoot: process.cwd(),
      });
      clearInterval(timer);
      const registry = iReg as unknown as Registry;
      const stats: BuildStats = {
        sourceFiles: registry.getFilesByType('source').length,
        testFiles: registry.getFilesByType('test').length,
        dependencies: registry.importGraph.dependencies.size,
        selectors: registry.getSelectorIndex().size,
        routes: registry.getRouteMap().size,
        duration: Date.now() - start,
      };
      setState((s) => ({ ...s, buildPhase: 'saving', buildStats: stats, registry }));
      // Pre-run all 3 analyses in the background immediately
      runAnalysis(registry, 'src/api/auth.ts', 0);
      runAnalysis(registry, 'src/components/auth/LoginForm.tsx', 1);
      runAnalysis(registry, 'src/api/products.ts', 2);
      setState((s) => ({ ...s, working: false, reacting: true, reactTyped: 0 }));
    } finally {
      restore();
    }
  }, [runAnalysis]);

  // ── Key input ────────────────────────────────────────────────────────────────

  useInput((_, key) => {
    if (!key.return) return;

    // Skip typewriter
    if (!state.ready) {
      if (state.reacting && state.reactTyped < reactionText.length) {
        setState((s) => ({ ...s, reactTyped: reactionText.length, ready: true }));
      } else {
        setState((s) => ({ ...s, typed: dialogue.length, ready: true }));
      }
      return;
    }

    if (state.working) return;

    // If in reaction phase, advance to next stage
    const idx = STAGE_ORDER.indexOf(state.stage);
    const next = STAGE_ORDER[idx + 1] as DemoStage | undefined;
    if (!next) {
      exit();
      return;
    }

    setState((s) => ({
      ...s,
      stage: next,
      typed: 0,
      ready: false,
      reacting: false,
      reactTyped: 0,
    }));

    if (next === 'detect') runDetect();
    if (next === 'build') runBuild();
    // For example stages: analysis already running in background; show reaction after results appear
    if (next === 'ex1' || next === 'ex2' || next === 'ex3') {
      const exIdx = next === 'ex1' ? 0 : next === 'ex2' ? 1 : 2;
      // Poll until example is done, then trigger reaction
      const poll = setInterval(() => {
        setState((s) => {
          const ex = s.examples[exIdx as 0 | 1 | 2];
          if (ex.done && !s.reacting && s.ready) {
            clearInterval(poll);
            return { ...s, reacting: true, reactTyped: 0, ready: false };
          }
          return s;
        });
      }, 100);
    }
  });

  // ── Border color logic ───────────────────────────────────────────────────────

  const borderColor = state.error
    ? palette.rose
    : state.stage === 'fin'
      ? palette.emerald
      : palette.border;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Panel borderColor={borderColor}>
      <Header icon="🦅" title="demo" subtitle={STAGE_LABELS[state.stage]} />

      {/* ── SPLASH ── */}
      {state.stage === 'splash' && (
        <>
          <SectionDivider />
          <Box flexDirection="column" alignItems="center" marginTop={1} marginBottom={1}>
            <PercyArt />
            <PercyBox text={dialogue} typed={state.typed} />
          </Box>
        </>
      )}

      {/* ── STORY, DETECT (setup text only), BUILD (setup text only) ── */}
      {(state.stage === 'story' ||
        (state.stage === 'detect' && !state.detectDone) ||
        state.stage === 'build') &&
        dialogue && (
          <>
            <SectionDivider />
            <PercyBox text={dialogue} typed={state.typed} />
          </>
        )}

      {/* ── DETECT results ── */}
      {state.stage === 'detect' && state.frameworks.length > 0 && (
        <>
          {!state.detectDone && (
            <>
              <SectionDivider />
              <PercyBox text={dialogue} typed={state.typed} />
            </>
          )}
          <SectionDivider label="project scan" />
          <Box flexDirection="column" marginTop={1}>
            {state.frameworks.map((f, i) => (
              <FrameworkRow key={i} f={f} visible={true} />
            ))}
          </Box>
          {state.reacting && (
            <>
              <SectionDivider />
              <PercyBox text={REACTION.detect!} typed={state.reactTyped} inline />
            </>
          )}
        </>
      )}

      {/* ── BUILD progress ── */}
      {state.stage === 'build' && (
        <>
          <SectionDivider label="registry build" />
          <BuildProgress phase={state.buildPhase} stats={state.buildStats} />
          {state.reacting && (
            <>
              <SectionDivider />
              <PercyBox text={REACTION.build!} typed={state.reactTyped} inline />
            </>
          )}
        </>
      )}

      {/* ── EXAMPLES ── */}
      {(state.stage === 'ex1' || state.stage === 'ex2' || state.stage === 'ex3') &&
        (() => {
          const exIdx = state.stage === 'ex1' ? 0 : state.stage === 'ex2' ? 1 : 2;
          const ex = state.examples[exIdx as 0 | 1 | 2];
          return (
            <>
              <SectionDivider />
              <PercyBox text={SETUP[state.stage]} typed={state.typed} />
              <ExampleSection ex={ex} reacting={state.reacting} reactTyped={state.reactTyped} />
            </>
          );
        })()}

      {/* ── FIN ── */}
      {state.stage === 'fin' && (
        <>
          <SectionDivider />
          <Box flexDirection="row" alignItems="flex-start">
            <Box>
              <PercyBox text={SETUP.fin} typed={state.typed} />
            </Box>
            <Box flexGrow={1} justifyContent="center" marginTop={1}>
              <PercyArt />
            </Box>
          </Box>
        </>
      )}

      {/* ── Error ── */}
      {state.error && (
        <>
          <SectionDivider />
          <Text color={palette.rose} bold>
            ✘ {state.error}
          </Text>
        </>
      )}

      {/* ── Hint ── */}
      {state.ready && !state.working && (
        <>
          <SectionDivider />
          <Box justifyContent="flex-end">
            <Text color={palette.muted}>{HINTS[state.stage]}</Text>
          </Box>
        </>
      )}
    </Panel>
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const demoCommand = new Command('demo')
  .description('Interactive walkthrough with Percy — no setup required')
  .action(async () => {
    await loadTheme();
    const { waitUntilExit } = render(<DemoApp />);
    await waitUntilExit();
  });
