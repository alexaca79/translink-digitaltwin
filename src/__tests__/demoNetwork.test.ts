import { describe, expect, it } from 'vitest';

import {
  createSimulatedAlerts,
  createSimulatedVehicles,
  TRANSLINK_ROUTES,
} from '@/data/demoNetwork';

describe('TransLink demo network', () => {
  it('produces stable, geographically valid vehicle telemetry', () => {
    const observedAt = new Date('2026-08-13T12:00:00Z');
    const first = createSimulatedVehicles(observedAt);
    const second = createSimulatedVehicles(observedAt);

    expect(first).toEqual(second);
    expect(first).toHaveLength(42);
    expect(new Set(first.map((vehicle) => vehicle.id)).size).toBe(first.length);
    expect(first.every((vehicle) => vehicle.latitude >= 49.16 && vehicle.latitude <= 49.32)).toBe(true);
    expect(first.every((vehicle) => vehicle.longitude >= -123.15 && vehicle.longitude <= -122.78)).toBe(true);
    expect(first.every((vehicle) => TRANSLINK_ROUTES.some((route) => route.id === vehicle.routeId))).toBe(true);
  });

  it('labels every synthetic service alert as simulated content', () => {
    const alerts = createSimulatedAlerts(new Date('2026-08-13T12:00:00Z'));

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((alert) => alert.description.toLowerCase().includes('synthetic'))).toBe(true);
  });
});