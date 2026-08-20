import GtfsRealtimeBindings, { type transit_realtime } from 'gtfs-realtime-bindings';

import type { ServiceAlert, TransitMode, TransitSnapshot, VehicleState, VehicleTelemetry } from '../src/types/transit.js';
import type { RealtimeFeedConfig } from './config.js';
import type { GtfsScheduleLookup, ScheduledStopTime } from './gtfsSchedule.js';
import type {
  NormalizedTransitEvent,
  PollResult,
  ServiceAlertEvent,
  TripUpdateEvent,
  VehiclePositionEvent,
} from './events.js';
import { computeScheduleDeviation, medianDeviation } from './scheduleDeviation.js';

const RAIL_ROUTES = new Set(['13686', '30052', '30053', '6770']);
const FERRY_ROUTES = new Set(['6771']);

function longToNumber(value: number | Long | null | undefined) {
  if (typeof value === 'number') return value;
  return value?.toNumber() ?? 0;
}

function routeMode(routeId: string): TransitMode {
  if (RAIL_ROUTES.has(routeId)) return 'rail';
  if (FERRY_ROUTES.has(routeId)) return 'ferry';
  return 'bus';
}

function occupancy(status: transit_realtime.VehiclePosition.OccupancyStatus | null | undefined) {
  switch (status) {
    case 0:
    case 1:
      return 'low' as const;
    case 2:
    case 3:
      return 'medium' as const;
    case 4:
    case 5:
      return 'high' as const;
    default:
      return 'unknown' as const;
  }
}

function translatedText(value: transit_realtime.ITranslatedString | null | undefined) {
  return value?.translation?.find((translation) => translation.language?.toLowerCase().startsWith('en'))?.text
    ?? value?.translation?.[0]?.text
    ?? '';
}

function severity(value: transit_realtime.Alert.SeverityLevel | null | undefined): ServiceAlert['severity'] {
  if (value === 4) return 'critical';
  if (value === 3) return 'warning';
  return 'info';
}

function enumName(enumType: Record<number, string>, value: number | null | undefined) {
  return value == null ? 'UNKNOWN' : enumType[value] ?? String(value);
}

async function fetchFeed(name: string, endpoint: string, apiKey: string) {
  const url = new URL(endpoint);
  url.searchParams.set('apikey', apiKey);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/x-protobuf, application/octet-stream',
      'User-Agent': 'translink-digital-twin/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${name} feed returned ${response.status} ${response.statusText}.`);
  }
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(await response.arrayBuffer())
  );
}

function tripUpdateEvents(
  feed: transit_realtime.FeedMessage,
  observedAt: Date,
  scheduleLookup: GtfsScheduleLookup | null
): {
  events: TripUpdateEvent[];
  delaysByTrip: Map<string, number>;
  delaysByVehicle: Map<string, number>;
  hasScheduleSignal: boolean;
} {
  const events: TripUpdateEvent[] = [];
  const computedByTrip = new Map<string, number>();
  const computedByVehicle = new Map<string, number>();
  const reportedByTrip = new Map<string, number>();
  const reportedByVehicle = new Map<string, number>();
  const pendingEvents: Array<{ event: TripUpdateEvent; hasSignal: boolean }> = [];

  const reportedDelay = (value: object | null | undefined) => {
    if (!value || !Object.prototype.hasOwnProperty.call(value, 'delay')) return null;
    const delay = Reflect.get(value, 'delay');
    return typeof delay === 'number' ? delay : null;
  };

  const stopDeviation = (
    stop: transit_realtime.TripUpdate.IStopTimeUpdate,
    scheduled: ScheduledStopTime | null
  ) => {
    if (!scheduled) return null;
    const arrivalEpoch = longToNumber(stop.arrival?.time);
    const departureEpoch = longToNumber(stop.departure?.time);
    if (arrivalEpoch && scheduled.arrivalSeconds != null) {
      return computeScheduleDeviation(arrivalEpoch, scheduled.arrivalSeconds);
    }
    if (departureEpoch && scheduled.departureSeconds != null) {
      return computeScheduleDeviation(departureEpoch, scheduled.departureSeconds);
    }
    return null;
  };

  for (const entity of feed.entity) {
    const update = entity.tripUpdate;
    if (!update) continue;
    const tripId = update.trip?.tripId ?? '';
    const routeId = update.trip?.routeId ?? '';
    const vehicleId = update.vehicle?.id ?? '';
    const stopTimeUpdates = update.stopTimeUpdate ?? [];
    const updateDelay = reportedDelay(update);
    const reportedDelays = [
      updateDelay,
      ...stopTimeUpdates.flatMap((stop) => [
        reportedDelay(stop.arrival),
        reportedDelay(stop.departure),
      ]),
    ].filter((delay): delay is number => delay != null);
    const tripDelay = updateDelay ?? reportedDelays[0] ?? 0;
    if (tripId && reportedDelays.length > 0) reportedByTrip.set(tripId, tripDelay);
    if (vehicleId && reportedDelays.length > 0) reportedByVehicle.set(vehicleId, tripDelay);
    const computedStopDelays: number[] = [];

    for (const stop of stopTimeUpdates) {
      const stopId = stop.stopId ?? '';
      const scheduled = scheduleLookup?.getStopTime(
        tripId,
        stop.stopSequence ?? 0,
        stopId
      ) ?? null;
      const computedDelay = stopDeviation(stop, scheduled);
      if (computedDelay != null) computedStopDelays.push(computedDelay);
      pendingEvents.push({
        hasSignal: computedDelay != null || reportedDelays.length > 0,
        event: {
        eventType: 'TripUpdate',
        eventId: `${entity.id}:${stop.stopSequence ?? stopId}:${observedAt.getTime()}`,
        observedAt: observedAt.toISOString(),
        tripId,
        routeId,
        vehicleId,
        stopId,
        stopSequence: stop.stopSequence ?? 0,
        arrivalEpochSeconds: longToNumber(stop.arrival?.time),
        departureEpochSeconds: longToNumber(stop.departure?.time),
        delaySeconds: computedDelay
          ?? reportedDelay(stop.arrival)
          ?? reportedDelay(stop.departure)
          ?? tripDelay,
        source: 'translink-gtfs-rt',
        },
      });
    }

    const computedTripDelay = medianDeviation(computedStopDelays);
    if (computedTripDelay != null && tripId) computedByTrip.set(tripId, computedTripDelay);
    if (computedTripDelay != null && vehicleId) computedByVehicle.set(vehicleId, computedTripDelay);
  }

  for (const pending of pendingEvents) {
    events.push({
      ...pending.event,
      delaySeconds: pending.hasSignal ? pending.event.delaySeconds : null,
    });
  }

  const delaysByTrip = new Map(computedByTrip);
  const delaysByVehicle = new Map(computedByVehicle);
  for (const [tripId, delay] of reportedByTrip) {
    if (!delaysByTrip.has(tripId)) delaysByTrip.set(tripId, delay);
  }
  for (const [vehicleId, delay] of reportedByVehicle) {
    if (!delaysByVehicle.has(vehicleId)) delaysByVehicle.set(vehicleId, delay);
  }
  const hasScheduleSignal = delaysByTrip.size > 0 || delaysByVehicle.size > 0;
  return { events, delaysByTrip, delaysByVehicle, hasScheduleSignal };
}

function vehicleEvents(
  feed: transit_realtime.FeedMessage,
  observedAt: Date,
  delaysByTrip: Map<string, number>,
  delaysByVehicle: Map<string, number>,
  hasScheduleSignal: boolean
): { events: VehiclePositionEvent[]; vehicles: VehicleTelemetry[] } {
  const events: VehiclePositionEvent[] = [];
  const vehicles: VehicleTelemetry[] = [];

  for (const entity of feed.entity) {
    const vehicle = entity.vehicle;
    const position = vehicle?.position;
    if (!vehicle || !position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) continue;
    if (position.latitude === 0 || position.longitude === 0) continue;

    const routeId = vehicle.trip?.routeId ?? '';
    const tripId = vehicle.trip?.tripId ?? '';
    const vehicleId = vehicle.vehicle?.id ?? entity.id;
    const vehicleLabel = vehicle.vehicle?.label ?? vehicleId;
    const reportedDelay = delaysByTrip.get(tripId) ?? delaysByVehicle.get(vehicleId);
    const delaySeconds = hasScheduleSignal ? reportedDelay ?? null : null;
    const state: VehicleState = delaySeconds == null
      ? 'unknown'
      : delaySeconds > 180
        ? 'delayed'
        : delaySeconds < -120
          ? 'early'
          : 'on-time';
    const observed = longToNumber(vehicle.timestamp)
      ? new Date(longToNumber(vehicle.timestamp) * 1000)
      : observedAt;
    const normalizedOccupancy = occupancy(vehicle.occupancyStatus);
    const normalized: VehiclePositionEvent = {
      eventType: 'VehiclePosition',
      eventId: `${entity.id}:${observed.getTime()}`,
      observedAt: observed.toISOString(),
      vehicleId,
      vehicleLabel,
      tripId,
      routeId,
      mode: routeMode(routeId),
      latitude: position.latitude,
      longitude: position.longitude,
      bearing: position.bearing ?? 0,
      speedKph: Math.round((position.speed ?? 0) * 3.6 * 10) / 10,
      scheduleDeviationSeconds: delaySeconds,
      occupancy: normalizedOccupancy,
      state,
      stopId: vehicle.stopId ?? '',
      currentStatus: enumName(GtfsRealtimeBindings.transit_realtime.VehiclePosition.VehicleStopStatus, vehicle.currentStatus),
      source: 'translink-gtfs-rt',
    };
    events.push(normalized);
    vehicles.push({
      id: vehicleId,
      routeId,
      tripId,
      label: `${routeId || 'TransLink'} · ${vehicleLabel}`,
      mode: normalized.mode,
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      bearing: normalized.bearing,
      speedKph: normalized.speedKph,
      scheduleDeviationSeconds: delaySeconds,
      occupancy: normalizedOccupancy,
      state,
      observedAt: normalized.observedAt,
    });
  }
  return { events, vehicles };
}

function alertEvents(
  feed: transit_realtime.FeedMessage,
  observedAt: Date
): { events: ServiceAlertEvent[]; alerts: ServiceAlert[] } {
  const events: ServiceAlertEvent[] = [];
  const alerts: ServiceAlert[] = [];

  for (const entity of feed.entity) {
    const alert = entity.alert;
    if (!alert) continue;
    const informedEntities = alert.informedEntity ?? [];
    const activePeriods = alert.activePeriod ?? [];
    const routeIds = [...new Set(informedEntities.map((selector) => selector.routeId).filter(Boolean))] as string[];
    const title = translatedText(alert.headerText) || 'TransLink service alert';
    const description = translatedText(alert.descriptionText);
    const normalizedSeverity = severity(alert.severityLevel);
    const observedEpoch = Math.floor(observedAt.getTime() / 1000);
    const periods = activePeriods.map((period) => ({
      start: longToNumber(period.start),
      end: longToNumber(period.end),
    }));
    const currentPeriod = periods.find(
      (period) =>
        (period.start === 0 || period.start <= observedEpoch) &&
        (period.end === 0 || period.end > observedEpoch)
    );
    const nextPeriod = periods
      .filter((period) => period.start > observedEpoch)
      .sort((left, right) => left.start - right.start)[0];
    const latestPeriod = [...periods].sort((left, right) => right.end - left.end)[0];
    const relevantPeriod = currentPeriod ?? nextPeriod ?? latestPeriod ?? { start: 0, end: 0 };
    events.push({
      eventType: 'ServiceAlert',
      eventId: `${entity.id}:${observedAt.getTime()}`,
      observedAt: observedAt.toISOString(),
      alertId: entity.id,
      severity: normalizedSeverity,
      title,
      description,
      routeIds,
      cause: enumName(GtfsRealtimeBindings.transit_realtime.Alert.Cause, alert.cause),
      effect: enumName(GtfsRealtimeBindings.transit_realtime.Alert.Effect, alert.effect),
      activeStartEpochSeconds: relevantPeriod.start,
      activeEndEpochSeconds: relevantPeriod.end,
      source: 'translink-gtfs-rt',
    });
    alerts.push({
      id: entity.id,
      severity: normalizedSeverity,
      title,
      description,
      routeIds,
      updatedAt: observedAt.toISOString(),
    });
  }
  return { events, alerts };
}

export async function pollTransLinkFeeds(
  feeds: RealtimeFeedConfig,
  scheduleLookup: GtfsScheduleLookup | null = null
): Promise<PollResult> {
  const observedAt = new Date();
  const vehicleFeedPromise = fetchFeed('positions', feeds.positionsUrl, feeds.apiKey);
  const tripFeedPromise = fetchFeed('trips', feeds.tripsUrl, feeds.apiKey).catch((error: unknown) => {
    console.warn('Trip-update feed unavailable for this poll:', error instanceof Error ? error.message : error);
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
      header: { gtfsRealtimeVersion: '2.0' },
    });
  });
  const alertFeedPromise = fetchFeed('alerts', feeds.alertsUrl, feeds.apiKey).catch((error: unknown) => {
    console.warn('Alert feed unavailable for this poll:', error instanceof Error ? error.message : error);
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
      header: { gtfsRealtimeVersion: '2.0' },
    });
  });
  const [vehicleFeed, tripFeed, alertFeed] = await Promise.all([
    vehicleFeedPromise,
    tripFeedPromise,
    alertFeedPromise,
  ]);

  await scheduleLookup?.prefetch(
    tripFeed.entity.map((entity) => entity.tripUpdate?.trip?.tripId ?? '').filter(Boolean)
  );
  const tripUpdates = tripUpdateEvents(tripFeed, observedAt, scheduleLookup);
  const vehiclePositions = vehicleEvents(
    vehicleFeed,
    observedAt,
    tripUpdates.delaysByTrip,
    tripUpdates.delaysByVehicle,
    tripUpdates.hasScheduleSignal
  );
  const serviceAlerts = alertEvents(alertFeed, observedAt);
  const events: NormalizedTransitEvent[] = [
    ...vehiclePositions.events,
    ...tripUpdates.events,
    ...serviceAlerts.events,
  ];
  const snapshot: TransitSnapshot = {
    source: 'translink-gtfs-rt',
    observedAt: observedAt.toISOString(),
    vehicles: vehiclePositions.vehicles,
    alerts: serviceAlerts.alerts,
  };
  return { events, snapshot };
}