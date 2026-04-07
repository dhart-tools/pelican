import { getRepoRoot } from '@v2/core/git';
import { RegistryBuilder } from '@v2/core/registry/registry-builder';
import { saveRegistryCache } from '@v2/core/registry/registry-cache';

import { loadConfig } from '../config-loader';

/**
 * Command to manually build the project's suggestion registry.
 */
export async function runBuildRegistry(options: { force?: boolean }): Promise<void> {
  const projectRoot = getRepoRoot();
  const config = await loadConfig(projectRoot);

  const cachePath = `${projectRoot}/.suggestor/registry.json`;

  console.log('🏗 Building project registry...');

  const startTime = Date.now();

  const registry = await RegistryBuilder.build(config, projectRoot, (progress) => {
    // Basic terminal progress indication
    process.stdout.write(`\r  [${progress.current}/${progress.total}] ${progress.message.padEnd(80)}`);
  });

  process.stdout.write('\r' + ' '.repeat(100) + '\r');

  // 4. Save to cache
  await saveRegistryCache(registry, cachePath, config, projectRoot);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Registry built successfully in ${duration}s.`);
}
