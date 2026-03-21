import chalk from "chalk";

export const theme = {
  // Colors
  primary: chalk.hex("#7C3AED"),     // Purple
  secondary: chalk.hex("#06B6D4"),   // Cyan
  success: chalk.hex("#10B981"),     // Green
  warning: chalk.hex("#F59E0B"),     // Amber
  error: chalk.hex("#EF4444"),       // Red
  dim: chalk.dim,
  bold: chalk.bold,
  
  // Semantic
  fileName: chalk.hex("#06B6D4").bold,
  keyword: chalk.hex("#7C3AED"),
  score: (confidence: number) => {
    if (confidence >= 0.8) return chalk.hex("#10B981").bold;
    if (confidence >= 0.5) return chalk.hex("#F59E0B");
    return chalk.hex("#EF4444");
  },
  
  // Icons
  icons: {
    success: "✓",
    error: "✗",
    warning: "⚠",
    arrow: "→",
    bullet: "●",
    circle: "○",
    star: "★",
    analyzing: "◆",
  },

  // Box drawing
  header: (text: string) => {
    const line = "─".repeat(text.length + 4);
    return `┌${line}┐\n│  ${chalk.bold(text)}  │\n└${line}┘`;
  },
} as const;
