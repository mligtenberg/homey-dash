/** A browser and the system it runs on, in words, from a user agent string; null parts where it isn't recognised. */
export interface BrowserText {
  browser: string | null;
  system: string | null;
}

/** Reads a user agent string, which is only a hint: browsers copy each other's, so the order of the checks matters. */
export function describeUserAgent(ua: string | null): BrowserText {
  if (!ua) return { browser: null, system: null };
  return { browser: browserOf(ua), system: systemOf(ua) };
}

function browserOf(ua: string): string | null {
  const version = (token: RegExp) => ua.match(token)?.[1];
  const named = (name: string, token: RegExp) => {
    const v = version(token);
    return v ? `${name} ${v}` : name;
  };
  if (/Edg(?:e|A|iOS)?\//.test(ua)) return named('Edge', /Edg(?:e|A|iOS)?\/(\d+)/);
  if (/OPR\//.test(ua)) return named('Opera', /OPR\/(\d+)/);
  if (/Firefox\/|FxiOS\//.test(ua)) return named('Firefox', /(?:Firefox|FxiOS)\/(\d+)/);
  // Android's WebView, which Fully Kiosk Browser and other kiosk apps are made of, says so in its user agent.
  if (/; wv\)/.test(ua)) return named('Android WebView', /Chrome\/(\d+)/);
  if (/CriOS\//.test(ua)) return named('Chrome', /CriOS\/(\d+)/);
  if (/Chrome\//.test(ua)) return named('Chrome', /Chrome\/(\d+)/);
  if (/Safari\//.test(ua)) return named('Safari', /Version\/(\d+(?:\.\d+)?)/);
  return null;
}

function systemOf(ua: string): string | null {
  const android = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (android) return `Android ${android[1]}`;
  const ios = ua.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)/);
  if (ios) return `${/iPad/.test(ua) ? 'iPadOS' : 'iOS'} ${ios[1]}.${ios[2]}`;
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}
