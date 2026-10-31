import { signal } from '@angular/core';
import {
  CapabilityValue,
  DisplayInfo,
  HomeySnapshot,
  PhotoSet,
  PlexCommand,
  PlexSnapshot,
  Realtime,
  RealtimeMessages,
  ScreenView,
} from './index';

/**
 * Stands in for the realtime connection in tests: answers joins with `screen` and `displays`, records what a
 * screen reports and the commands tiles send, and lets a test push messages or simulate a reconnect. Provide it
 * as `Realtime`.
 */
export class FakeRealtime implements Partial<Realtime> {
  readonly connected = signal(true);
  screen: ScreenView | null = null;
  displays: DisplayInfo[] = [];
  readonly joined: string[] = [];
  /** What a screen reported it shows, each time: published version by dashboard id. */
  readonly shown: Record<string, number>[] = [];
  /** Commands sent to Homey, such as `['setCapability', 'd1', 'onoff', true]`. */
  readonly commands: unknown[][] = [];
  /** Makes commands fail, as when Homey does not respond. */
  failCommands = false;
  /** Called as a screen reports the versions it shows. */
  onShowing: (versions: Record<string, number>) => void = () => undefined;

  private readonly joins = new Set<() => void>();
  private readonly handlers = new Map<string, ((message: unknown) => void)[]>();

  whenConnected(join: () => void) {
    this.joins.add(join);
    if (this.connected()) join();
    return () => this.joins.delete(join);
  }

  on<K extends keyof RealtimeMessages>(name: K, handler: (message: RealtimeMessages[K]) => void) {
    const listener = handler as (message: unknown) => void;
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), listener]);
    return () => this.handlers.set(name, (this.handlers.get(name) ?? []).filter((h) => h !== listener));
  }

  push<K extends keyof RealtimeMessages>(name: K, message: RealtimeMessages[K]) {
    this.handlers.get(name)?.forEach((handler) => handler(message));
  }

  reconnect() {
    this.connected.set(true);
    this.joins.forEach((join) => join());
  }

  async homey(): Promise<HomeySnapshot> {
    return { status: { connection: 'connected', lastError: null, since: '', fake: true }, devices: [], flows: [], moods: [], zones: [], flowFolders: [], loaded: true };
  }

  photoSetList: PhotoSet[] = [];

  async photoSets() {
    return this.photoSetList;
  }

  plexSnapshot: PlexSnapshot = {
    overview: { status: 'connected', error: null, loaded: true, libraries: [], players: [] },
    sessions: [],
  };

  async plex() {
    return this.plexSnapshot;
  }

  controlPlex(playerId: string, command: PlexCommand) {
    return this.command('controlPlex', playerId, command);
  }

  async joinScreen(screenId: string) {
    this.joined.push(screenId);
    return this.screen;
  }

  async showing(versions: Record<string, number>) {
    this.shown.push(versions);
    this.onShowing(versions);
  }

  async joinManagement() {
    return this.displays;
  }

  setCapability(deviceId: string, capabilityId: string, value: CapabilityValue) {
    return this.command('setCapability', deviceId, capabilityId, value);
  }

  triggerFlow(flowId: string) {
    return this.command('triggerFlow', flowId);
  }

  activateMood(moodId: string) {
    return this.command('activateMood', moodId);
  }

  private async command(...command: unknown[]) {
    this.commands.push(command);
    if (this.failCommands) throw new Error('Homey did not respond');
  }
}
