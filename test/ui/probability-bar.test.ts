import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProbabilityBar } from '@/components/incidents/probability-bar';

function render(value: number, extra: { detail?: string; emphasis?: 'brand' | 'muted' } = {}) {
  return renderToStaticMarkup(createElement(ProbabilityBar, { label: 'Fixable in config', value, ...extra }));
}

describe('ProbabilityBar', () => {
  it('renders the label, a rounded percentage and a matching fill width', () => {
    const html = render(0.826);
    expect(html).toContain('Fixable in config');
    expect(html).toContain('83%');
    expect(html).toContain('aria-valuenow="83"');
    expect(html).toContain('width:82.6%');
  });

  it('clamps out-of-range and non-finite values', () => {
    expect(render(1.7)).toContain('width:100%');
    expect(render(-0.2)).toContain('width:0%');
    expect(render(Number.NaN)).toContain('0%');
  });

  it('uses the accent by default and a muted fill on request', () => {
    expect(render(0.5)).toContain('bg-brand');
    expect(render(0.5, { emphasis: 'muted' })).not.toContain('bg-brand');
  });

  it('shows the detail line when given', () => {
    expect(render(0.4, { detail: 'Nothing is destroyed or replaced' })).toContain(
      'Nothing is destroyed or replaced',
    );
  });
});
