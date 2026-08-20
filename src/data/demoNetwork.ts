import type {
  Coordinate,
  ServiceAlert,
  TransitRoute,
  VehicleTelemetry,
} from '@/types/transit';

export const TRANSLINK_ROUTES: TransitRoute[] = [
  {
    id: '30053',
    shortName: 'Expo',
    longName: 'Expo Line',
    mode: 'rail',
    color: '#0033a0',
    path: [
      [-123.1119, 49.2857], [-123.1161, 49.2832], [-123.1093, 49.2795],
      [-123.1007, 49.2732], [-123.0695, 49.2626], [-123.0232, 49.2297],
      [-123.0038, 49.2258], [-122.9588, 49.2124], [-122.9127, 49.2013],
      [-122.8894, 49.2048], [-122.867, 49.1991], [-122.8476, 49.1895],
      [-122.8448, 49.1828],
    ],
  },
  {
    id: '30052',
    shortName: 'Millennium',
    longName: 'Millennium Line',
    mode: 'rail',
    color: '#ffcd00',
    path: [
      [-123.0788, 49.2658], [-123.0695, 49.2626], [-123.0455, 49.2589],
      [-123.0135, 49.2664], [-122.9982, 49.2662], [-122.9391, 49.2534],
      [-122.897, 49.2485], [-122.8894, 49.2614], [-122.8452, 49.2772],
      [-122.8282, 49.2797], [-122.8001, 49.2856], [-122.7917, 49.2855],
    ],
  },
  {
    id: '13686',
    shortName: 'Canada',
    longName: 'Canada Line',
    mode: 'rail',
    color: '#007c9f',
    path: [
      [-123.1119, 49.2857], [-123.1168, 49.2826], [-123.1219, 49.2745],
      [-123.1158, 49.2633], [-123.1155, 49.2492], [-123.1165, 49.2331],
      [-123.1177, 49.2098], [-123.1254, 49.1942], [-123.1366, 49.1747],
      [-123.1364, 49.1681],
    ],
  },
  {
    id: '6771',
    shortName: 'SeaBus',
    longName: 'SeaBus',
    mode: 'ferry',
    color: '#746661',
    path: [
      [-123.1119, 49.2857], [-123.102, 49.2918], [-123.092, 49.2991],
      [-123.0827, 49.3101],
    ],
  },
  {
    id: '37807',
    shortName: 'R5',
    longName: 'Hastings St',
    mode: 'bus',
    color: '#008522',
    path: [
      [-123.1208, 49.2856], [-123.0997, 49.2811], [-123.0776, 49.281],
      [-123.0565, 49.281], [-123.023, 49.2812], [-122.9955, 49.2801],
      [-122.954, 49.2787], [-122.9194, 49.2781],
    ],
  },
];

const VEHICLES_PER_ROUTE: Record<string, number> = {
  '30053': 12,
  '30052': 10,
  '13686': 9,
  '6771': 3,
  '37807': 8,
};

function distance([longitudeA, latitudeA]: Coordinate, [longitudeB, latitudeB]: Coordinate) {
  const longitudeScale = Math.cos(((latitudeA + latitudeB) / 2) * (Math.PI / 180));
  return Math.hypot((longitudeB - longitudeA) * longitudeScale, latitudeB - latitudeA);
}

function pointAlongPath(path: Coordinate[], progress: number) {
  const segmentLengths = path.slice(1).map((point, index) => distance(path[index], point));
  const totalLength = segmentLengths.reduce((total, length) => total + length, 0);
  let remaining = progress * totalLength;

  for (let index = 0; index < segmentLengths.length; index += 1) {
    if (remaining <= segmentLengths[index]) {
      const segmentProgress = segmentLengths[index] === 0 ? 0 : remaining / segmentLengths[index];
      const [startLongitude, startLatitude] = path[index];
      const [endLongitude, endLatitude] = path[index + 1];
      const longitude = startLongitude + (endLongitude - startLongitude) * segmentProgress;
      const latitude = startLatitude + (endLatitude - startLatitude) * segmentProgress;
      const bearing = (Math.atan2(endLongitude - startLongitude, endLatitude - startLatitude) * 180) / Math.PI;
      return { longitude, latitude, bearing: (bearing + 360) % 360 };
    }
    remaining -= segmentLengths[index];
  }

  const [longitude, latitude] = path.at(-1) ?? path[0];
  return { longitude, latitude, bearing: 0 };
}

export function createSimulatedVehicles(observedAt: Date): VehicleTelemetry[] {
  const elapsedSeconds = observedAt.getTime() / 1000;

  return TRANSLINK_ROUTES.flatMap((route, routeIndex) => {
    const vehicleCount = VEHICLES_PER_ROUTE[route.id];
    return Array.from({ length: vehicleCount }, (_, vehicleIndex) => {
      const cycle = (elapsedSeconds / (680 + routeIndex * 65) + vehicleIndex / vehicleCount) % 2;
      const progress = cycle <= 1 ? cycle : 2 - cycle;
      const position = pointAlongPath(route.path, progress);
      const scheduleDeviationSeconds = Math.round(
        Math.sin(elapsedSeconds / 93 + vehicleIndex * 1.61 + routeIndex) * 210 +
          (vehicleIndex % 8 === 0 ? 150 : 0)
      );
      const state = scheduleDeviationSeconds > 180
        ? 'delayed'
        : scheduleDeviationSeconds < -120
          ? 'early'
          : 'on-time';

      return {
        id: `${route.id}-${String(2100 + vehicleIndex).padStart(4, '0')}`,
        routeId: route.id,
        tripId: `SIM-${route.id}-${vehicleIndex + 1}`,
        label: `${route.shortName} · ${2100 + vehicleIndex}`,
        mode: route.mode,
        latitude: position.latitude,
        longitude: position.longitude,
        bearing: position.bearing,
        speedKph: Math.max(4, Math.round(22 + Math.sin(elapsedSeconds / 17 + vehicleIndex) * 11)),
        scheduleDeviationSeconds,
        occupancy: (['low', 'medium', 'high'] as const)[(vehicleIndex + routeIndex) % 3],
        state,
        observedAt: observedAt.toISOString(),
      };
    });
  });
}

export function createSimulatedAlerts(observedAt: Date): ServiceAlert[] {
  return [
    {
      id: 'sim-alert-1',
      severity: 'warning',
      title: 'Slower service through the Broadway corridor',
      description: 'Synthetic TransLink demonstration alert caused by modeled congestion.',
      routeIds: ['37807'],
      updatedAt: observedAt.toISOString(),
    },
    {
      id: 'sim-alert-2',
      severity: 'info',
      title: 'Expo Line headways under observation',
      description: 'Synthetic TransLink demonstration alert for schedule-adherence monitoring.',
      routeIds: ['30053'],
      updatedAt: observedAt.toISOString(),
    },
  ];
}