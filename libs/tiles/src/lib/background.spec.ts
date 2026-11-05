import { backgroundStyle, hasImage, renderedBackgroundStyle } from './background';

describe('backgroundStyle', () => {
  it('is the theme ground without a background', () => {
    expect(backgroundStyle(null)).toBeNull();
    expect(backgroundStyle(undefined)).toBeNull();
  });

  it('paints a colour, a gradient at its angle, or an uploaded image covering the screen', () => {
    expect(backgroundStyle({ kind: 'color', color: '#102030' })).toBe('#102030');
    expect(backgroundStyle({ kind: 'gradient', color: '#102030', to: '#405060', angle: 135 })).toBe(
      'linear-gradient(135deg, #102030, #405060)',
    );
    expect(backgroundStyle({ kind: 'image', imageId: 'abc' })).toBe('center / cover no-repeat url(/api/backgrounds/abc)');
  });

  it('paints a built-in image by day in the light theme and by night in the dark one', () => {
    expect(backgroundStyle({ kind: 'preset', preset: 'flat/garden' })).toBe(
      'center / cover no-repeat var(--hide-in-dark, url("/backgrounds/flat/garden-day.svg")) ' +
        'var(--hide-in-light, url("/backgrounds/flat/garden-night.svg"))',
    );
  });

  it('paints a built-in image from other pictures, such as recoloured ones', () => {
    expect(backgroundStyle({ kind: 'preset', preset: 'flat/garden' }, { day: 'data:a', night: 'data:b' })).toBe(
      'center / cover no-repeat var(--hide-in-dark, url("data:a")) var(--hide-in-light, url("data:b"))',
    );
  });

  it('turns tiles to glass over an uploaded or built-in image only', () => {
    expect(hasImage({ kind: 'image', imageId: 'abc' })).toBe(true);
    expect(hasImage({ kind: 'preset', preset: 'flat/garden' })).toBe(true);
    expect(hasImage({ kind: 'color', color: '#102030' })).toBe(false);
    expect(hasImage(null)).toBe(false);
  });
});

describe('renderedBackgroundStyle', () => {
  it('asks HomeyDash for a built-in image at the screen’s size, in its colour scheme', () => {
    expect(renderedBackgroundStyle({ kind: 'preset', preset: 'flat/garden', color: '#3d7ae0', angle: 30 }, 1280, 800, 1.5)).toBe(
      'center / cover no-repeat ' +
        'var(--hide-in-dark, url("/api/backgrounds/presets/flat/garden-day.webp?width=1920&height=1200&color=%233d7ae0&angle=30")) ' +
        'var(--hide-in-light, url("/api/backgrounds/presets/flat/garden-night.webp?width=1920&height=1200&color=%233d7ae0&angle=30"))',
    );
  });

  it('rounds sizes up to a step, and paints anything else as it is', () => {
    expect(renderedBackgroundStyle({ kind: 'preset', preset: 'flat/garden' }, 1001, 10, 1)).toContain('width=1008&height=16"');
    expect(renderedBackgroundStyle({ kind: 'color', color: '#102030' }, 100, 100)).toBe('#102030');
  });
});
