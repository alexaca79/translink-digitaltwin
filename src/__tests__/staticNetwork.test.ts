import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VEHICLE_STATE_COLORS } from '@/data/transitColors';
import type { StaticNetworkAsset } from '@/types/transit';

const asset = JSON.parse(
  readFileSync(resolve('public/data/translink-network.json'), 'utf8')
) as StaticNetworkAsset;

describe('TransLink static network', () => {
  it.each([
    ['13686', 'Canada', 'Canada Line', '#007c9f', '#FFFFFF'],
    ['30052', 'Millennium', 'Millennium Line', '#ffcd00', '#333333'],
    ['30053', 'Expo', 'Expo Line', '#0033a0', '#FFFFFF'],
  ])('imports SkyTrain route %s with its canonical name and color', (
    routeId,
    shortName,
    longName,
    color,
    textColor
  ) => {
    expect(asset.routes.find((route) => route.id === routeId)).toMatchObject({
      shortName,
      longName,
      mode: 'rail',
      color,
      textColor,
    });
  });

  it('uses the same operational state colors as the map legend', () => {
    expect(VEHICLE_STATE_COLORS).toEqual({
      'on-time': '#151515',
      delayed: '#d71920',
      early: '#147d64',
      unknown: '#86857f',
    });
  });
});