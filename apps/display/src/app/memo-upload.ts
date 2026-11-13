import { inject, Injectable } from '@angular/core';
import { DisplaysApi, Realtime } from '@homey-dash/api-client';
import { VoiceMemos } from '@homey-dash/tiles';

/** Hands over the voice memos this screen keeps (recordings and texts) when Management asks for them. */
@Injectable({ providedIn: 'root' })
export class MemoUpload {
  private readonly api = inject(DisplaysApi);
  private readonly realtime = inject(Realtime);
  private readonly memos = inject(VoiceMemos);

  /** Answers memo requests until the returned function is called. */
  answer() {
    return this.realtime.on('Memos', (requestId) => void this.send(requestId));
  }

  private async send(requestId: string) {
    try {
      const files = await this.memos.upload();
      await new Promise<void>((done, fail) => this.api.sendMemos(requestId, files).subscribe({ next: () => done(), error: fail }));
    } catch {
      // Management gives up waiting and says so.
    }
  }
}
