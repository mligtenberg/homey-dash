import { themeFor } from './auto-theme';

describe('themeFor', () => {
  it('is dark in a dark room and light in a lit one', () => {
    expect(themeFor(2, null)).toBe('dark');
    expect(themeFor(300, null)).toBe('light');
  });

  it('keeps the current theme between the two lines', () => {
    expect(themeFor(30, 'dark')).toBe('dark');
    expect(themeFor(30, 'light')).toBe('light');
  });

  it('switches only once past the far line', () => {
    expect(themeFor(14, 'light')).toBe('dark');
    expect(themeFor(51, 'dark')).toBe('light');
  });
});
