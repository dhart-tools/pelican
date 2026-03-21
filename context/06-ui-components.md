# Part 6: UI Components

> **Prerequisite**: Read `00-base-context.md` first.

## Scope

Build all terminal UI components using **ink** (React for terminals). These are the visual layer — spinners, progress bars, status lines, and result tables that make the CLI feel premium.

## Files to Create

| File | Purpose |
|---|---|
| `src/ui/theme.ts` | Color palette & style constants |
| `src/ui/components/common/ProgressBar.tsx` | Animated progress bar |
| `src/ui/components/common/StatusLine.tsx` | Status indicator with spinner |
| `src/ui/components/common/ResultsTable.tsx` | Formatted results display |
| `src/ui/components/SetupView.tsx` | Setup command complete UI |
| `src/ui/components/IndexView.tsx` | Index command complete UI |
| `src/ui/components/SuggestView.tsx` | Suggest command complete UI |

## Dependencies on Other Parts

- **Part 1** (types): Uses `ISuggestionResult`, `IFileEntry` from `src/types.ts`
- Uses `ink` and `react` packages
- No other part dependencies — these are pure presentation components

---

## Step-by-Step Instructions

### Step 1: Create `src/ui/theme.ts`

Define the visual theme — every component uses these constants.

```typescript
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
```

### Step 2: Create `src/ui/components/common/ProgressBar.tsx`

An ink component that renders an animated progress bar.

```tsx
import React from "react";
import { Box, Text } from "ink";
```

**Props:**
```typescript
interface ProgressBarProps {
  value: number;      // 0-100
  total?: number;     // Optional total for "X/Y" display
  label?: string;     // Label text
  width?: number;     // Bar width in chars, default 30
}
```

**Behavior:**
- Render a horizontal bar: `[████████░░░░░░]`
- Use `▓` for filled, `░` for empty (or similar Unicode block chars)
- Show percentage on the right: `67%`
- If `total` is provided, also show `completed/total` (e.g., for bytes downloaded)
- Color the filled portion with `theme.primary`
- Minimum width: 20 chars

**Example output:**
```
Pulling model  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  60% (1.2GB/2.0GB)
```

### Step 3: Create `src/ui/components/common/StatusLine.tsx`

A status indicator that shows current activity with a spinner.

```tsx
import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
```

> **Note:** Add `ink-spinner` to package.json dependencies: `"ink-spinner": "^5.0.0"`

**Props:**
```typescript
interface StatusLineProps {
  status: "loading" | "success" | "error" | "warning" | "idle";
  message: string;
  detail?: string;    // Dimmed secondary text
}
```

**Behavior:**
- `loading` → show spinner + message
- `success` → show `✓` in green + message
- `error` → show `✗` in red + message
- `warning` → show `⚠` in amber + message
- `idle` → show `○` dimmed + message
- If `detail` is provided, show it dimmed on the same line after `—`

### Step 4: Create `src/ui/components/common/ResultsTable.tsx`

Displays suggestion results in a formatted table.

```tsx
import React from "react";
import { Box, Text } from "ink";
```

**Props:**
```typescript
interface ResultsTableProps {
  results: Array<{
    testFile: string;
    confidence: number;
    reason: string;
    matchedKeywords: string[];
  }>;
  title?: string;
}
```

**Behavior:**
- Header row: `Test File | Confidence | Reason`
- Each result on its own row:
  - File name colored with `theme.fileName`
  - Confidence as a colored score badge: `[0.92]` green, `[0.65]` amber, `[0.35]` red
  - Reason text (truncated to 50 chars if long)
- Below the table: show matched keywords as tags: `[device-manager] [connection]`
- If no results: show a dimmed message `"No relevant tests found"`
- Show total count: `"Found 5 relevant test files"`

**Example output:**
```
 ┌─ Suggested Tests ──────────────────────────────────────────┐
 │                                                             │
 │  Test File                        Confidence   Reason       │
 │  ─────────────────────────────────────────────────────────  │
 │  deviceManager.test.ts            [0.92]       Shared...    │
 │  connectionPool.test.ts           [0.78]       Tests...     │
 │  deviceGroup.spec.ts              [0.45]       Related...   │
 │                                                             │
 │  Keywords: [device-manager] [connection] [pool]             │
 │  Found 3 relevant test files                                │
 └─────────────────────────────────────────────────────────────┘
```

### Step 5: Create `src/ui/components/SetupView.tsx`

Full UI for the setup command.

**Props:**
```typescript
interface SetupViewProps {
  steps: Array<{
    name: string;
    status: "loading" | "success" | "error" | "idle";
    detail?: string;
  }>;
  pullProgress?: {
    status: string;
    completed?: number;
    total?: number;
  };
}
```

**Behavior:**
- Show app header: `"🔧 Suggestor Setup"`
- List each step as a `StatusLine`
- When pulling model, show `ProgressBar` below the relevant step
- On completion: show success summary with colored text

### Step 6: Create `src/ui/components/IndexView.tsx`

Full UI for the index command.

**Props:**
```typescript
interface IndexViewProps {
  status: "scanning" | "analyzing" | "saving" | "done" | "error";
  totalFiles: number;
  processedFiles: number;
  currentFile?: string;
  newFiles: number;
  updatedFiles: number;
  error?: string;
}
```

**Behavior:**
- Show header: `"📇 Indexing Files"`
- Show overall progress bar: `processedFiles / totalFiles`
- Show current file being analyzed (dimmed, truncated path)
- When done: show summary stats in a box:
  ```
  ✓ Indexing complete
    New files:     12
    Updated files: 3
    Total indexed: 45
  ```

### Step 7: Create `src/ui/components/SuggestView.tsx`

Full UI for the suggest command.

**Props:**
```typescript
interface SuggestViewProps {
  status: "detecting" | "analyzing" | "matching" | "ranking" | "done" | "error";
  changedFiles: string[];
  results: Array<{
    testFile: string;
    confidence: number;
    reason: string;
    matchedKeywords: string[];
  }>;
  error?: string;
}
```

**Behavior:**
- Show header: `"🔍 Test Suggestions"`
- During processing: show `StatusLine` for each phase
- Show list of changed files detected
- When done: render `ResultsTable` with results
- If no changes detected: show dimmed message `"No file changes detected"`

---

## Guidelines

- **All components are functional React components** using hooks (`useState`, `useEffect`)
- **Ink constraints**: No CSS, no flexbox gaps. Use `<Box marginRight={1}>` for spacing
- **Text wrapping**: Terminal widths vary. Use `process.stdout.columns` to determine width, default to 80
- **No animations via intervals in components**: Ink's `Spinner` component handles animation. For progress bars, just re-render with new props
- **Color accessibility**: All meaningful info must be conveyed by text AND color (not color alone) — icons handle this
- **Export all components as named exports**

## Edge Cases to Handle

1. **Very narrow terminal** (< 60 cols) → truncate file paths, reduce table columns
2. **Very long file names** → truncate with `…` suffix
3. **Zero results** → show helpful "no results" message
4. **Error states** → red colored error with icon

## Verification

- Each component renders without errors in an ink `<render>` context
- Visual check: colors, alignment, and spacing look polished in the terminal
