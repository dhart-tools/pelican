import React from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';
import { Command } from 'commander';
import { palette, setTheme, ThemeName } from '../theme';
import { readUserConfig, writeUserConfig } from '../user-config';

function ThemeResult({ themeName, changed }: { themeName: ThemeName; changed: boolean }) {
  const label = themeName === 'dark' ? 'dark' : 'light';
  const accent = themeName === 'dark' ? '#22D3EE' : '#0891B2';

  return (
    <Box flexDirection="column" marginX={1} marginY={1}>
      {changed ? (
        <Box>
          <Text color="#34D399" bold>✔  </Text>
          <Text color={palette.text}>Theme set to </Text>
          <Text color={accent} bold>{label}</Text>
          <Text color={palette.dim}>  ·  saved to ~/.pelican/config.json</Text>
        </Box>
      ) : (
        <Box>
          <Text color={palette.dim}>Current theme: </Text>
          <Text color={accent} bold>{label}</Text>
          <Text color={palette.muted}>  ·  run </Text>
          <Text color={palette.brand} bold>
            pelican theme {themeName === 'dark' ? 'light' : 'dark'}
          </Text>
          <Text color={palette.muted}> to switch</Text>
        </Box>
      )}
    </Box>
  );
}

export const themeCommand = new Command('theme')
  .description('Get or set the color theme (dark | light)')
  .argument('[name]', 'Theme name: dark or light')
  .action(async (name?: string) => {
    const config = await readUserConfig();

    if (!name) {
      // Show current theme
      setTheme(config.theme);
      const { waitUntilExit } = render(
        <ThemeResult themeName={config.theme} changed={false} />,
      );
      await waitUntilExit();
      return;
    }

    if (name !== 'dark' && name !== 'light') {
      process.stderr.write(`Unknown theme "${name}". Valid values: dark, light\n`);
      process.exit(1);
    }

    const themeName = name as ThemeName;
    await writeUserConfig({ theme: themeName });
    setTheme(themeName);

    const { waitUntilExit } = render(
      <ThemeResult themeName={themeName} changed={true} />,
    );
    await waitUntilExit();
  });
