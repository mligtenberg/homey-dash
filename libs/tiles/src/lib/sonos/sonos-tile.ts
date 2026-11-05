import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { HomeyDevice, homeyImageUrl, Realtime } from '@homey-dash/api-client';
import {
  LucideDynamicIcon,
  LucideLink,
  LucidePause,
  LucidePlay,
  LucideSkipBack,
  LucideSkipForward,
  LucideSpeaker,
  LucideUnlink,
} from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';

/** One of the tile's speakers; `found` is false for a device Homey does not have (any more). */
interface Room {
  id: string;
  name: string;
  found: boolean;
  available: boolean;
  /** The room's own volume, 0–1. */
  volume: number;
  /** Speakers with the same group name play together. */
  group: string | null;
  device: HomeyDevice | undefined;
}

/** What a drag on one of the sliders is at: a room's own volume, or `group` for the whole group's. */
interface Drag {
  key: string;
  value: number;
}

/**
 * Sonos multiroom on one tile (several speakers, picked in Management): what the lead room plays over its album art, with
 * buttons to skip back, play or pause, and skip on, and one volume for the whole group. A press opens the detail view
 * with every room, its own volume and a button that adds the room to the lead's group or takes it out again; a full
 * tall tile lists them on the tile too. The lead is the
 * first room that plays, else the first. Speakers are in a group when Homey's `sonos_group` is the same for them.
 */
@Component({
  selector: 'hd-sonos-tile',
  imports: [LucideDynamicIcon, NgTemplateOutlet, TileDetails],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    ...TILE_FACE_HOST,
    class: 'hd-tile hd-sonos',
    '[class.has-art]': '!!art()',
    '[style.--art]': "art() ? 'url(' + art() + ')' : null",
  },
  template: `
    <div class="hd-sonos__head">
      <svg class="hd-icon" [lucideIcon]="speakerIcon" />
      <div class="hd-sonos__titles">
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
      @if (lead(); as lead) {
        <div class="hd-round-btns">
          @if (canSkip() && size() !== 'small') {
            <button
              type="button"
              class="hd-round-btn"
              aria-label="Previous"
              (click)="press(lead, 'speaker_prev')"
            >
              <svg [lucideIcon]="backIcon" />
            </button>
          }
          <button
            type="button"
            class="hd-round-btn"
            [attr.aria-label]="playing() ? 'Pause' : 'Play'"
            (click)="toggle(lead)"
          >
            <svg [lucideIcon]="playing() ? pauseIcon : playIcon" />
          </button>
          @if (canSkip() && size() !== 'small') {
            <button
              type="button"
              class="hd-round-btn"
              aria-label="Next"
              (click)="press(lead, 'speaker_next')"
            >
              <svg [lucideIcon]="forwardIcon" />
            </button>
          }
        </div>
      }
    </div>
    <ng-template #groupRow>
      @if (lead(); as lead) {
        <div class="hd-sonos__row">
          <span class="hd-sonos__label">{{
            grouped().length > 1 ? 'Group' : 'Volume'
          }}</span>
          <div
            class="hd-slider"
            role="slider"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-label]="
              'Volume of ' + (grouped().length > 1 ? 'the group' : lead.name)
            "
            [attr.aria-valuenow]="percent('group', lead.volume)"
            tabindex="0"
            (pointerdown)="slideStart($event, 'group')"
            (pointermove)="slideMove($event, 'group')"
            (pointerup)="slideEnd($event, 'group', lead)"
            (pointercancel)="drag.set(null)"
            (keydown.arrowleft)="nudge($event, lead, -0.05, true)"
            (keydown.arrowright)="nudge($event, lead, 0.05, true)"
          >
            <div
              class="hd-slider__fill"
              [style.width.%]="percent('group', lead.volume)"
            ></div>
          </div>
        </div>
      }
    </ng-template>
    <ng-template #roomList>
      <div class="hd-sonos__rooms">
        @for (room of rooms(); track room.id) {
          <div class="hd-sonos__row" [class.is-in-group]="inGroup(room)">
            <span class="hd-sonos__label">{{ room.name }}</span>
            @if (room.found) {
              <div
                class="hd-slider"
                role="slider"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-label]="'Volume of ' + room.name"
                [attr.aria-valuenow]="percent(room.id, room.volume)"
                tabindex="0"
                (pointerdown)="slideStart($event, room.id)"
                (pointermove)="slideMove($event, room.id)"
                (pointerup)="slideEnd($event, room.id, room)"
                (pointercancel)="drag.set(null)"
                (keydown.arrowleft)="nudge($event, room, -0.05, false)"
                (keydown.arrowright)="nudge($event, room, 0.05, false)"
              >
                <div
                  class="hd-slider__fill"
                  [style.width.%]="percent(room.id, room.volume)"
                ></div>
              </div>
              <button
                type="button"
                class="hd-round-btn"
                [class.is-busy]="busy(room)"
                [disabled]="room.id === lead()?.id || !room.available || busy(room)"
                [attr.aria-busy]="busy(room)"
                [attr.aria-pressed]="inGroup(room)"
                [attr.aria-label]="
                  inGroup(room)
                    ? 'Take ' + room.name + ' out of the group'
                    : 'Play in ' + room.name
                "
                (click)="toggleGroup(room)"
              >
                @if (!busy(room)) {
                  <svg [lucideIcon]="inGroup(room) ? linkIcon : unlinkIcon" />
                }
              </button>
            } @else {
              <span class="hd-sonos__label">Not found in Homey</span>
            }
          </div>
        }
      </div>
    </ng-template>
    @if (size() !== 'small') {
      <ng-container *ngTemplateOutlet="groupRow" />
    }
    @if (size() === 'full-tall') {
      <ng-container *ngTemplateOutlet="roomList" />
    }
    <hd-tile-details
      [name]="face().name"
      [icon]="speakerIcon"
      [subtitle]="face().detail"
    >
      <ng-container *ngTemplateOutlet="groupRow" />
      <ng-container *ngTemplateOutlet="roomList" />
    </hd-tile-details>
  `,
})
export class SonosTile extends TileView {
  private readonly realtime = inject(Realtime);

  protected readonly speakerIcon = LucideSpeaker;
  protected readonly backIcon = LucideSkipBack;
  protected readonly forwardIcon = LucideSkipForward;
  protected readonly playIcon = LucidePlay;
  protected readonly pauseIcon = LucidePause;
  protected readonly linkIcon = LucideLink;
  protected readonly unlinkIcon = LucideUnlink;

  protected readonly drag = signal<Drag | null>(null);
  /** Rooms whose group change Homey is still working on, by the membership they are waiting for. */
  protected readonly joining = signal<ReadonlyMap<string, boolean>>(new Map());

  constructor() {
    super();
    // Joining or leaving takes Homey a while: a room is busy until it reports the new membership.
    effect(() => {
      const waiting = this.joining();
      const done = [...waiting].filter(([id, inGroup]) => {
        const room = this.rooms().find((r) => r.id === id);
        return !room || this.inGroup(room) === inGroup;
      });
      if (done.length) this.settle(done.map(([id]) => id));
    });
  }

  protected busy(room: Room) {
    return this.joining().has(room.id);
  }

  private settle(ids: string[]) {
    this.joining.update((m) => new Map([...m].filter(([id]) => !ids.includes(id))));
  }

  protected readonly rooms = computed<Room[]>(() => {
    const known = this.homey()?.devices ?? new Map<string, HomeyDevice>();
    return (this.settings().targets ?? []).map((id) => {
      const device = known.get(id);
      const group = device?.capabilities['sonos_group']?.value;
      const volume = device?.capabilities['volume_set']?.value;
      return {
        id,
        name: device?.name ?? 'Not found',
        found: !!device,
        available: !!device?.available,
        volume: typeof volume === 'number' ? volume : 0,
        group: typeof group === 'string' ? group : null,
        device,
      };
    });
  });

  /** The room whose music the tile shows: the first that plays, else the first. */
  protected readonly lead = computed((): Room | undefined => {
    const rooms = this.rooms().filter((r) => r.found);
    return (
      rooms.find(
        (r) => r.device?.capabilities['speaker_playing']?.value === true,
      ) ?? rooms[0]
    );
  });

  protected readonly playing = computed(
    () => this.lead()?.device?.capabilities['speaker_playing']?.value === true,
  );

  /** The rooms that play together with the lead, the lead included. */
  protected readonly grouped = computed(() => {
    const lead = this.lead();
    return lead
      ? this.rooms().filter(
          (r) => r.id === lead.id || (!!lead.group && r.group === lead.group),
        )
      : [];
  });

  protected readonly canSkip = computed(
    () => !!this.lead()?.device?.capabilities['speaker_next']?.setable,
  );

  protected readonly art = computed(() => {
    const device = this.lead()?.device;
    const accountId = this.homey()?.accountId;
    return this.playing() && device?.albumArt && accountId !== undefined
      ? homeyImageUrl(accountId, device.albumArt)
      : null;
  });

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideSpeaker, hue: 'appliance' as const };
    const name = this.settings().label || 'Speakers';
    if (!this.rooms().length)
      return { ...look, name, detail: 'Pick speakers', state: 'unset' };
    if (!this.homeyLoaded())
      return { ...look, name, detail: '…', state: 'loading' };
    const lead = this.lead();
    if (!lead)
      return { ...look, name, detail: 'Not found in Homey', state: 'missing' };
    const caps = lead.device?.capabilities ?? {};
    const text = (id: string) =>
      typeof caps[id]?.value === 'string' ? (caps[id].value as string) : '';
    const track = [text('speaker_track'), text('speaker_artist')]
      .filter(Boolean)
      .join(' · ');
    const together =
      this.grouped().length > 1 ? `${this.grouped().length} rooms · ` : '';
    const detail =
      this.flash() === 'error'
        ? 'Did not respond'
        : this.playing()
          ? together + (track || lead.name)
          : `${lead.name} · Not playing`;
    return {
      ...look,
      name,
      detail,
      active: this.playing(),
      details: true,
      state: lead.available ? 'ok' : 'unavailable',
    };
  });

  protected inGroup(room: Room) {
    return this.grouped().some((r) => r.id === room.id);
  }

  protected percent(key: string, volume: number) {
    const drag = this.drag();
    return Math.round((drag?.key === key ? drag.value : volume) * 100);
  }

  protected toggle(room: Room) {
    this.set(room, 'speaker_playing', !this.playing());
  }

  protected press(room: Room, capability: string) {
    this.set(room, capability, true);
  }

  protected toggleGroup(room: Room) {
    const lead = this.lead();
    if (!lead || room.id === lead.id) return;
    if (this.busy(room)) return;
    const account = this.settings().account;
    const join = !this.inGroup(room);
    this.joining.update((m) => new Map(m).set(room.id, join));
    // Give up waiting after a while, so a change Homey never reports does not keep the room busy.
    setTimeout(() => this.settle([room.id]), 30000);
    this.send(
      () =>
        join
          ? this.realtime.joinSpeakerGroup(account, room.id, lead.id)
          : this.realtime.leaveSpeakerGroup(account, room.id),
      'quiet',
    ).then(() => undefined, () => this.settle([room.id]));
  }

  private set(room: Room, capability: string, value: boolean | number) {
    // The tile changes when Homey reports the new value, not before.
    return this.send(
      () =>
        this.realtime.setCapability(
          this.settings().account,
          room.id,
          capability,
          value,
        ),
      'quiet',
    );
  }

  private setVolume(room: Room, volume: number, wholeGroup: boolean) {
    const account = this.settings().account;
    if (!wholeGroup)
      return this.set(room, 'volume_set', Math.round(volume * 100) / 100);
    // A group of one is set like the room.
    if (this.grouped().length < 2)
      return this.set(room, 'volume_set', Math.round(volume * 100) / 100);
    return this.send(
      () =>
        this.realtime.setGroupVolume(
          account,
          room.id,
          Math.max(1, volume * 100),
        ),
      'quiet',
    );
  }

  protected slideStart(event: PointerEvent, key: string) {
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.slideMove(event, key, true);
  }

  protected slideMove(event: PointerEvent, key: string, starting = false) {
    if (!starting && this.drag()?.key !== key) return;
    const track = (event.currentTarget as Element).getBoundingClientRect();
    this.drag.set({
      key,
      value: Math.min(
        1,
        Math.max(0, (event.clientX - track.left) / (track.width || 1)),
      ),
    });
  }

  protected async slideEnd(event: PointerEvent, key: string, room: Room) {
    this.slideMove(event, key);
    const drag = this.drag();
    if (drag?.key !== key) return;
    await this.setVolume(room, drag.value, key === 'group');
    this.drag.set(null);
  }

  protected nudge(event: Event, room: Room, by: number, wholeGroup: boolean) {
    event.preventDefault();
    this.setVolume(
      room,
      Math.min(1, Math.max(0, room.volume + by)),
      wholeGroup,
    );
  }
}
