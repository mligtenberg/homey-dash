import { backgroundStyle, hasImage } from './background';

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
