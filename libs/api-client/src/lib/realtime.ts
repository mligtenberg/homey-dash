import { Injectable, signal } from '@angular/core';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { DisplayInfo, ScreenView } from './displays';
import { CapabilityValue, HomeyDevice, HomeyFlow, HomeyMood, HomeyStatus } from './homey';

// Mirrors apps/api/Realtime/RealtimeHub.cs.

export interface HomeySnapshot {
  status: HomeyStatus;
  devices: HomeyDevice[];
  flows: HomeyFlow[];
  moods: HomeyMood[];
}

export interface HomeyCatalog {
  flows: HomeyFlow[];
  moods: HomeyMood[];
}

/** The messages HomeyDash pushes, by name. */
export interface RealtimeMessages {
  DeviceChanged: HomeyDevice;
  DeviceRemoved: string;
  Catalog: HomeyCatalog;
  HomeyStatus: HomeyStatus;
  /** What a joined screen now is and shows; null sends it to setup. */
  Screen: ScreenView | null;
  /** Every display with its status, for Management. */
  Displays: DisplayInfo[];
}

// Displays run unattended, so reconnecting never gives up; it just slows down.
const RETRY_MS = [0, 1_000, 2_000, 5_000, 10_000, 30_000];

function retryDelay(attempt: number) {
  return RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
}

/**
 * The realtime connection to HomeyDash that both apps keep open. Messages sent while it is down are lost, so
 * whatever depends on them loads its state again in `whenConnected`.
 */
@Injectable({ providedIn: 'root' })
export class Realtime {
  private readonly hub = new HubConnectionBuilder()
    .withUrl('/api/realtime')
    .withAutomaticReconnect({ nextRetryDelayInMilliseconds: ({ previousRetryCount }) => retryDelay(previousRetryCount) })
    .configureLogging(LogLevel.Warning)
    .build();
  private readonly joins = new Set<() => void>();

  readonly connected = signal(false);

  constructor() {
    this.hub.onreconnecting(() => this.connected.set(false));
    this.hub.onreconnected(() => this.ready());
    // Automatic reconnect only covers a connection that was up; a failed start or a server close needs a new start.
    this.hub.onclose(() => {
      this.connected.set(false);
      this.start(1);
    });
    this.start(0);
  }

  /** Runs `join` now when connected and again after every reconnect. Returns a function that stops it. */
  whenConnected(join: () => void): () => void {
    this.joins.add(join);
    if (this.connected()) join();
    return () => this.joins.delete(join);
  }

  /** Returns a function that stops listening. */
  on<K extends keyof RealtimeMessages>(name: K, handler: (message: RealtimeMessages[K]) => void): () => void {
    this.hub.on(name, handler);
    return () => this.hub.off(name, handler);
  }

  homey() {
    return this.hub.invoke<HomeySnapshot>('Homey');
  }

  /** Joins as the screen with this id: which display it is, or null when it belongs in setup. */
  joinScreen(screenId: string) {
    return this.hub.invoke<ScreenView | null>('JoinScreen', screenId);
  }

  /** Reports the published version this screen shows, or null while it waits for a dashboard. */
  showing(version: number | null) {
    return this.hub.invoke<void>('Showing', version);
  }

  /** Joins as Management, to receive `Displays`; answers with the current list. */
  joinManagement() {
    return this.hub.invoke<DisplayInfo[]>('JoinManagement');
  }

  setCapability(deviceId: string, capabilityId: string, value: CapabilityValue) {
    return this.hub.invoke<void>('SetCapability', deviceId, capabilityId, value);
  }

  triggerFlow(flowId: string) {
    return this.hub.invoke<void>('TriggerFlow', flowId);
  }

  activateMood(moodId: string) {
    return this.hub.invoke<void>('ActivateMood', moodId);
  }

  private start(attempt: number) {
    setTimeout(() => {
      this.hub.start().then(
        () => this.ready(),
        () => this.start(attempt + 1),
      );
    }, retryDelay(attempt));
  }

  private ready() {
    this.connected.set(true);
    for (const join of this.joins) join();
  }
}
