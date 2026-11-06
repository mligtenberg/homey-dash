import { describeUserAgent } from './browser-text';

describe('describeUserAgent', () => {
  it('names Chrome on Android', () => {
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')).toEqual({
      browser: 'Chrome 120',
      system: 'Android 13',
    });
  });

  it('recognises the Android WebView that Fully Kiosk Browser is made of', () => {
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 11; Lenovo TB; wv) AppleWebKit/537.36 Version/4.0 Chrome/119.0.0.0 Safari/537.36')).toEqual({
      browser: 'Android WebView 119',
      system: 'Android 11',
    });
  });

  it('names Safari on an iPad', () => {
    expect(describeUserAgent('Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Version/17.2 Mobile/15E148 Safari/604.1')).toEqual({
      browser: 'Safari 17.2',
      system: 'iPadOS 17.2',
    });
  });

  it('prefers Edge over the Chrome it claims to be', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0').browser).toBe('Edge 120');
  });

  it('knows nothing of an empty one', () => {
    expect(describeUserAgent(null)).toEqual({ browser: null, system: null });
  });
});
