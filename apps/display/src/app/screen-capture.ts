import { inject, Injectable } from '@angular/core';
import { DisplaysApi, Realtime } from '@homey-dash/api-client';

/**
 * Takes a screenshot of the page when Management asks for one, by drawing the page's elements into a picture, and
 * posts it back. It is what the screen shows, as the browser lays it out; a video or the camera is not in it.
 */
@Injectable({ providedIn: 'root' })
export class ScreenCapture {
  private readonly api = inject(DisplaysApi);
  private readonly realtime = inject(Realtime);

  /** Answers screenshot requests until the returned function is called. */
  answer() {
    return this.realtime.on('Screenshot', (requestId) => void this.take(requestId));
  }

  private async take(requestId: string) {
    try {
      // Loaded when first asked, as most screens never are.
      const { toJpeg } = await import('html-to-image');
      const page = document.documentElement;
      const url = await toJpeg(page, {
        quality: 0.8,
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: getComputedStyle(document.body).backgroundColor || '#000000',
        cacheBust: true,
      });
      const picture = await (await fetch(url)).blob();
      await new Promise<void>((done, fail) => this.api.sendScreenshot(requestId, picture).subscribe({ next: () => done(), error: fail }));
    } catch {
      // Management gives up waiting and says so.
    }
  }
}
