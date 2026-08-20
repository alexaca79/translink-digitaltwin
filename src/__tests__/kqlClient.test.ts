import { describe, expect, it } from 'vitest';

import {
  managedIdentityTokenUrl,
  mapAlertRows,
  mapFleetRows,
} from '../../ingest/kqlClient.js';

describe('Eventhouse authentication', () => {
  it('selects the configured user-assigned identity', () => {
    const url = managedIdentityTokenUrl(
      'http://localhost:42356/msi/token',
      '00000000-0000-0000-0000-000000000123'
    );

    expect(url.searchParams.get('resource')).toBe('https://kusto.kusto.windows.net');
    expect(url.searchParams.get('api-version')).toBe('2019-08-01');
    expect(url.searchParams.get('client_id')).toBe('00000000-0000-0000-0000-000000000123');
  });
});

describe('Eventhouse row projection', () => {
  it('maps CurrentFleet() rows onto vehicle telemetry', () => {
    const [vehicle] = mapFleetRows([
      {
        ObservedAt: '2026-08-17T14:03:00Z',
        VehicleId: '1234',
        VehicleLabel: 'TransLink 1234',
        TripId: 'trip-9',
        RouteId: '30053',
        Mode: 'rail',
        Latitude: 49.2857,
        Longitude: -123.1119,
        Bearing: 180,
        SpeedKph: 22.5,
        ScheduleDeviationSeconds: 240,
        Occupancy: 'high',
        State: 'delayed',
      },
    ]);

    expect(vehicle).toEqual({
      id: '1234',
      routeId: '30053',
      tripId: 'trip-9',
      label: 'TransLink 1234',
      mode: 'rail',
      latitude: 49.2857,
      longitude: -123.1119,
      bearing: 180,
      speedKph: 22.5,
      scheduleDeviationSeconds: 240,
      occupancy: 'high',
      state: 'delayed',
      observedAt: '2026-08-17T14:03:00.000Z',
    });
  });

  it('preserves null schedule deviation and falls back to safe enum values', () => {
    const [vehicle] = mapFleetRows([
      {
        ObservedAt: '2026-08-17T14:03:00Z',
        VehicleId: '9',
        RouteId: '29',
        Mode: 'hovercraft',
        ScheduleDeviationSeconds: null,
        Occupancy: 'packed',
        State: 'teleporting',
      },
    ]);

    expect(vehicle.scheduleDeviationSeconds).toBeNull();
    expect(vehicle.mode).toBe('bus');
    expect(vehicle.occupancy).toBe('unknown');
    expect(vehicle.state).toBe('unknown');
    expect(vehicle.label).toBe('9');
  });

  it('parses ActiveAlerts() route arrays whether dynamic or serialized', () => {
    const alerts = mapAlertRows([
      {
        ObservedAt: '2026-08-17T14:00:00Z',
        AlertId: 'alert-1',
        Severity: 'critical',
        Title: 'Line 1 closure',
        Description: 'No service between St George and Union.',
        RouteIds: ['1'],
      },
      {
        ObservedAt: '2026-08-17T14:00:00Z',
        AlertId: 'alert-2',
        Severity: 'unknown-severity',
        Title: '',
        Description: 'Detour in effect.',
        RouteIds: '["504","505"]',
      },
    ]);

    expect(alerts[0].routeIds).toEqual(['1']);
    expect(alerts[1].routeIds).toEqual(['504', '505']);
    expect(alerts[1].severity).toBe('warning');
    expect(alerts[1].title).toBe('TransLink service alert');
  });
});
