import GtfsRealtimeBindings, { type transit_realtime } from 'gtfs-realtime-bindings';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeFeedConfig } from '../../ingest/config';
import type { GtfsScheduleLookup } from '../../ingest/gtfsSchedule';
import { pollTransLinkFeeds } from '../../ingest/translinkGtfsRt';

const feeds: RealtimeFeedConfig = {
  apiKey: 'test-key',
  alertsUrl: 'https://example.test/alerts',
  positionsUrl: 'https://example.test/positions',
  tripsUrl: 'https://example.test/trips',
};

function encodeFeed(feed: transit_realtime.IFeedMessage) {
  const message = GtfsRealtimeBindings.transit_realtime.FeedMessage.create(feed);
  return Uint8Array.from(
    GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(message).finish()
  ).buffer;
}

function stubFeeds(
  delay: number,
  predictedArrivalEpoch?: number,
  activePeriods: Array<{ start: number; end: number }> = []
) {
  const header = { gtfsRealtimeVersion: '2.0' };
  const feeds = new Map([
    ['/positions', encodeFeed({
      header,
      entity: [{
        id: 'position-1',
        vehicle: {
          trip: { tripId: 'trip-1', routeId: '7' },
          vehicle: { id: 'vehicle-1', label: 'Vehicle 1' },
          position: { latitude: 49.25, longitude: -123.1 },
        },
      }],
    })],
    ['/trips', encodeFeed({
      header,
      entity: [{
        id: 'update-1',
        tripUpdate: {
          trip: { tripId: 'trip-1', routeId: '7' },
          vehicle: { id: 'vehicle-1' },
          delay,
          stopTimeUpdate: predictedArrivalEpoch == null ? [] : [{
            stopId: 'stop-1',
            stopSequence: 1,
            arrival: { time: predictedArrivalEpoch },
          }],
        },
      }],
    })],
    ['/alerts', encodeFeed({
      header,
      entity: activePeriods.length === 0 ? [] : [{
        id: 'alert-1',
        alert: {
          activePeriod: activePeriods,
          headerText: { translation: [{ text: 'Test service alert', language: 'en' }] },
        },
      }],
    })],
  ]);

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const pathname = new URL(String(input)).pathname;
    const body = feeds.get(pathname);
    if (!body) return new Response(null, { status: 404 });
    return new Response(body, { status: 200 });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TransLink GTFS-RT schedule status', () => {
  it('treats an explicitly reported zero delay as on time', async () => {
    stubFeeds(0);

    const result = await pollTransLinkFeeds(feeds);

    expect(result.snapshot.vehicles[0]).toMatchObject({
      scheduleDeviationSeconds: 0,
      state: 'on-time',
    });
    expect(result.events.find((event) => event.eventType === 'VehiclePosition')).toMatchObject({
      scheduleDeviationSeconds: 0,
      state: 'on-time',
    });
  });

  it('retains a meaningful nonzero delay from the trip-update feed', async () => {
    stubFeeds(240);

    const result = await pollTransLinkFeeds(feeds);

    expect(result.snapshot.vehicles[0]).toMatchObject({
      scheduleDeviationSeconds: 240,
      state: 'delayed',
    });
  });

  it('computes delay from predicted and static stop times when TransLink reports zero', async () => {
    stubFeeds(0, 1786719325);
    const scheduleLookup: GtfsScheduleLookup = {
      feedEndDate: '20991231',
      prefetch: vi.fn(async () => undefined),
      getStopTime: vi.fn(() => ({
        stopId: 'stop-1',
        stopSequence: 1,
        arrivalSeconds: 28_255,
        departureSeconds: 28_255,
      })),
      close: vi.fn(),
    };

    const result = await pollTransLinkFeeds(feeds, scheduleLookup);

    expect(result.snapshot.vehicles[0]).toMatchObject({
      scheduleDeviationSeconds: 270,
      state: 'delayed',
    });
    expect(result.events.find((event) => event.eventType === 'TripUpdate')).toMatchObject({
      delaySeconds: 270,
    });
  });

  it('keeps a trip without a schedule signal unknown when another trip reports delay', async () => {
    const header = { gtfsRealtimeVersion: '2.0' };
    const encodedFeeds = new Map([
      ['/positions', encodeFeed({ header, entity: [] })],
      ['/trips', encodeFeed({
        header,
        entity: [
          {
            id: 'reported-update',
            tripUpdate: {
              trip: { tripId: 'reported-trip', routeId: '7' },
              delay: 120,
              stopTimeUpdate: [{ stopId: 'reported-stop', stopSequence: 1 }],
            },
          },
          {
            id: 'unknown-update',
            tripUpdate: {
              trip: { tripId: 'unknown-trip', routeId: '7' },
              stopTimeUpdate: [{ stopId: 'unknown-stop', stopSequence: 1 }],
            },
          },
        ],
      })],
      ['/alerts', encodeFeed({ header, entity: [] })],
    ]);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const body = encodedFeeds.get(new URL(String(input)).pathname);
      return body ? new Response(body, { status: 200 }) : new Response(null, { status: 404 });
    }));

    const result = await pollTransLinkFeeds(feeds);

    expect(result.events.find(
      (event) => event.eventType === 'TripUpdate' && event.tripId === 'unknown-trip'
    )).toMatchObject({ delaySeconds: null });
  });

  it('uses an active alert period even when an expired period appears first', async () => {
    stubFeeds(0, undefined, [
      { start: 1, end: 2 },
      { start: 3, end: 4_102_444_800 },
    ]);

    const result = await pollTransLinkFeeds(feeds);

    expect(result.events.find((event) => event.eventType === 'ServiceAlert')).toMatchObject({
      activeStartEpochSeconds: 3,
      activeEndEpochSeconds: 4_102_444_800,
    });
  });
});