import { Injectable, signal } from '@angular/core';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { DashboardSummary } from './dashboards';
import { DisplayInfo, ScreenView } from './displays';
import { PhotoSet } from './photos';
import { PlexCommand, PlexOverview, PlexSession, PlexSnapshot } from './plex';
import { Rule, RuleAnswer, RuleAnswers } from './rules';
import { CapabilityValue, HomeyDevice, HomeyFlow, HomeyFlowFolder, HomeyMood, HomeyStatus, HomeyWeather, HomeyZone } from './homey';

// Mirrors apps/api/Realtime/RealtimeHub.cs.

/** The Homey of one account as it is now. */
export interface HomeySnapshot {
  accountId: number;
  /** The account's name, telling a home's Homeys apart. */
  accountName: string;
  status: HomeyStatus;
  devices: HomeyDevice[];
  flows: HomeyFlow[];
  moods: HomeyMood[];
  zones: HomeyZone[];
  flowFolders: HomeyFlowFolder[];
  /** False until the Homey's data first arrived; nothing is missing then. */
  loaded: boolean;
  /** Null until Homey first told it, or when Homey won't. */
  weather: HomeyWeather | null;
}

export interface HomeyCatalog {
  accountId: number;
  flows: HomeyFlow[];
  moods: HomeyMood[];
  zones: HomeyZone[];
  flowFolders: HomeyFlowFolder[];
}

/** The messages HomeyDash pushes, by name. */
export interface RealtimeMessages {
  /** Every Homey again, oldest account first, when a Homey account is added, removed or renamed. */
  Homeys: HomeySnapshot[];
  DeviceChanged: { accountId: number; device: HomeyDevice };
  DeviceRemoved: { accountId: number; deviceId: string };
  Catalog: HomeyCatalog;
  HomeyStatus: HomeyStatus;
  Weather: { accountId: number; weather: HomeyWeather };
  /** What a joined screen now is and shows; null sends it to setup. */
  Screen: ScreenView | null;
  /** Every display with its status, for Management. */
  Displays: DisplayInfo[];
  /** Every dashboard, for Management's sidebar. */
  Dashboards: DashboardSummary[];
  /** Every photo set, whenever one changes. */
  PhotoSets: PhotoSet[];
  /** Every Plex account's status, libraries and players, whenever one changes. */
  Plex: PlexOverview[];
  /** What plays on Plex, whenever more than its progress changed. */
  PlexSessions: PlexSession[];
  /** The answers to this connection's rule subscriptions that one change altered. */
  RuleAnswers: RuleAnswers;
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

  /** Every Homey, oldest account first; changes that follow arrive as messages naming the account. */
  homey() {
    return this.hub.invoke<HomeySnapshot[]>('Homey');
  }

  /** Every photo set with its photos; changes that follow arrive as `PhotoSets`. */
  photoSets() {
    return this.hub.invoke<PhotoSet[]>('PhotoSets');
  }

  /** Plex's libraries and what plays now; changes that follow arrive as `Plex` and `PlexSessions`. */
  plex() {
    return this.hub.invoke<PlexSnapshot>('Plex');
  }

  /** Plays, pauses or skips on a player of a Plex account; fails when the player takes no remote control. */
  controlPlex(accountId: number, playerId: string, command: PlexCommand) {
    return this.hub.invoke<void>('ControlPlex', accountId, playerId, command);
  }

  /** Joins as the screen with this id: which display it is, or null when it belongs in setup. */
  joinScreen(screenId: string) {
    return this.hub.invoke<ScreenView | null>('JoinScreen', screenId);
  }

  /** Reports the published version of each dashboard this screen offers, by dashboard id; none while it waits. */
  showing(versions: Record<string, number>) {
    return this.hub.invoke<void>('Showing', versions);
  }

  /** Joins as Management, to receive `Displays` and `Dashboards`; answers with the current display list. */
  joinManagement() {
    return this.hub.invoke<DisplayInfo[]>('JoinManagement');
  }

  // Each acts on the Homey of a tile's account (`settings.account`); without one, on the oldest.

  setCapability(account: number | undefined, deviceId: string, capabilityId: string, value: CapabilityValue) {
    return this.hub.invoke<void>('SetCapability', account ?? null, deviceId, capabilityId, value);
  }

  triggerFlow(account: number | undefined, flowId: string) {
    return this.hub.invoke<void>('TriggerFlow', account ?? null, flowId);
  }

  activateMood(account: number | undefined, moodId: string) {
    return this.hub.invoke<void>('ActivateMood', account ?? null, moodId);
  }

  /**
   * Subscribes to a rule under an id of this connection's choosing, answering whether it holds now; changes follow as
   * `RuleAnswers`. A screen's rules are evaluated for its display; Management's as if on `asDisplay`, or on none.
   * Subscriptions end with the connection, so subscribe again in `whenConnected`. Fails for an invalid rule.
   */
  subscribeRule(id: string, rule: Rule, asDisplay: string | null = null) {
    return this.hub.invoke<RuleAnswer>('SubscribeRule', id, rule, asDisplay);
  }

  unsubscribeRule(id: string) {
    return this.hub.invoke<void>('UnsubscribeRule', id);
  }

  /** Tells HomeyDash this screen was touched, for rules on when it was last touched. */
  touched() {
    return this.hub.invoke<void>('Touched');
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
