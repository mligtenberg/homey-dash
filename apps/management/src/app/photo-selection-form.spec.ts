import { defaultSelection, selectionSummary } from './photo-selection-form';

describe('selectionSummary', () => {
  it('reads as anyone and anything by default', () => {
    expect(selectionSummary(defaultSelection())).toBe('Anyone · 100 photos, every day');
  });

  it('names who is in and out, and what the photos show', () => {
    const summary = selectionSummary({
      with: [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bram' }],
      without: [{ id: 'c', name: 'Cas' }],
      query: 'landscape',
      count: 50,
      refreshHours: 0,
    });

    expect(summary).toBe('Anna or Bram, not Cas · landscape · 50 photos, only when I ask');
  });
});
