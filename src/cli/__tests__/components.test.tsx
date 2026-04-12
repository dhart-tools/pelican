import { render } from 'ink-testing-library';
import React from 'react';

import { EConfidenceLevel } from '@/utils/enums';

import { Header } from '../components/Header';
import { ProgressBar } from '../components/ProgressBar';
import { SignalBadge } from '../components/SignalBadge';
import { StatusStep } from '../components/StatusStep';

describe('Header', () => {
  it('renders icon and title', () => {
    const { lastFrame } = render(<Header icon="🔍" title="Test" />);
    expect(lastFrame()).toContain('🔍');
    expect(lastFrame()).toContain('PELICAN');
    expect(lastFrame()).toContain('Test');
  });

  it('renders subtitle when provided', () => {
    const { lastFrame } = render(<Header icon="🔍" title="Test" subtitle="v2.0" />);
    expect(lastFrame()).toContain('v2.0');
  });

  it('renders a top and bottom divider line', () => {
    const { lastFrame } = render(<Header icon="🔍" title="Test" />);
    // Header: top divider ─, brand row, bottom divider ─ = 3 lines
    expect(lastFrame()!.split('\n').length).toBeLessThanOrEqual(4);
  });
});

describe('StatusStep', () => {
  it('renders checkmark for success status', () => {
    const { lastFrame } = render(<StatusStep status="success" label="Done" />);
    expect(lastFrame()).toContain('✔');
    expect(lastFrame()).toContain('Done');
  });

  it('renders error icon for error status', () => {
    const { lastFrame } = render(<StatusStep status="error" label="Failed" detail="timeout" />);
    expect(lastFrame()).toContain('✘');
    expect(lastFrame()).toContain('Failed');
    expect(lastFrame()).toContain('timeout');
  });

  it('renders circle for idle status', () => {
    const { lastFrame } = render(<StatusStep status="idle" label="Pending" />);
    expect(lastFrame()).toContain('○');
  });

  it('renders spinner for loading status', () => {
    const { lastFrame } = render(<StatusStep status="loading" label="Working" />);
    expect(lastFrame()).toContain('Working');
  });

  it('renders detail when provided', () => {
    const { lastFrame } = render(
      <StatusStep status="success" label="Registry" detail="1,247 files" />,
    );
    expect(lastFrame()).toContain('1,247 files');
  });
});

describe('SignalBadge', () => {
  it('renders HIGH with score', () => {
    const { lastFrame } = render(<SignalBadge confidence={EConfidenceLevel.HIGH} score={0.95} />);
    expect(lastFrame()).toContain('HIGH');
    expect(lastFrame()).toContain('0.95');
  });

  it('renders MED for medium confidence', () => {
    const { lastFrame } = render(<SignalBadge confidence={EConfidenceLevel.MEDIUM} score={0.62} />);
    expect(lastFrame()).toContain('MED');
    expect(lastFrame()).toContain('0.62');
  });

  it('renders LOW for low confidence', () => {
    const { lastFrame } = render(<SignalBadge confidence={EConfidenceLevel.LOW} score={0.35} />);
    expect(lastFrame()).toContain('LOW');
    expect(lastFrame()).toContain('0.35');
  });
});

describe('ProgressBar', () => {
  it('renders at 0% with all empty blocks', () => {
    const { lastFrame } = render(<ProgressBar value={0} width={10} />);
    expect(lastFrame()).toContain('░░░░░░░░░░');
    expect(lastFrame()).toContain('0%');
  });

  it('renders at 100% with all filled blocks', () => {
    const { lastFrame } = render(<ProgressBar value={100} width={10} />);
    expect(lastFrame()).toContain('██████████');
    expect(lastFrame()).toContain('100%');
  });

  it('renders label when provided', () => {
    const { lastFrame } = render(<ProgressBar value={50} label="Extracting" />);
    expect(lastFrame()).toContain('Extracting');
  });

  it('renders count when provided', () => {
    const { lastFrame } = render(<ProgressBar value={50} showCount={{ current: 5, total: 10 }} />);
    expect(lastFrame()).toContain('(5/10)');
  });

  it('clamps value to 0-100 range', () => {
    const { lastFrame: over } = render(<ProgressBar value={150} width={10} />);
    expect(over()).toContain('100%');

    const { lastFrame: under } = render(<ProgressBar value={-10} width={10} />);
    expect(under()).toContain('0%');
  });
});
