import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'csv-parse/sync';
import unzipper from 'unzipper';

import { buildGtfsScheduleIndex } from '../ingest/gtfsSchedule.js';
import type {
  Coordinate,
  StaticNetworkAsset,
  TransitMode,
  TransitRoute,
  TransitStop,
} from '../src/types/transit.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceUrl = process.env.TRANSLINK_GTFS_STATIC_URL
  ?? 'https://gtfs-static.translink.ca/gtfs/google_transit.zip';
const licenseUrl = 'https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data';
const rawOutput = join(root, 'data', 'gtfs-static');
const webOutput = join(root, 'public', 'data', 'translink-network.json');

type CsvRecord = Record<string, string>;

const fixedGuidewayNames: Record<string, { shortName: string; longName: string }> = {
  '13686': { shortName: 'Canada', longName: 'Canada Line' },
  '30052': { shortName: 'Millennium', longName: 'Millennium Line' },
  '30053': { shortName: 'Expo', longName: 'Expo Line' },
  '6770': { shortName: 'WCE', longName: 'West Coast Express' },
  '6771': { shortName: 'SeaBus', longName: 'SeaBus' },
};

function mode(routeType: string): TransitMode | null {
  if (routeType === '1' || routeType === '2') return 'rail';
  if (routeType === '4') return 'ferry';
  if (routeType === '3' || routeType === '715') return 'bus';
  return null;
}

function color(value: string, routeMode: TransitMode) {
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value}`;
  if (routeMode === 'rail') return '#0060a9';
  if (routeMode === 'ferry') return '#746661';
  return '#0073c6';
}

function textColor(value: string, background: string) {
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value}`;
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 150 ? '#181817' : '#ffffff';
}

function compactPath(points: Coordinate[], maximumPoints = 420) {
  if (points.length <= maximumPoints) return points;
  const stride = Math.ceil(points.length / maximumPoints);
  const compacted = points.filter((_, index) => index % stride === 0);
  const finalPoint = points.at(-1);
  if (finalPoint && compacted.at(-1) !== finalPoint) compacted.push(finalPoint);
  return compacted;
}

function records(buffer: Buffer) {
  return parse(buffer, {
    bom: true,
    columns: true,
    relaxColumnCount: true,
    skipEmptyLines: true,
  }) as CsvRecord[];
}

async function main() {
  console.log(`Downloading TransLink GTFS from ${sourceUrl}`);
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`GTFS download failed (${response.status}): ${response.statusText}`);
  const archive = await unzipper.Open.buffer(Buffer.from(await response.arrayBuffer()));
  mkdirSync(rawOutput, { recursive: true });

  const required = new Set(['routes.txt', 'trips.txt', 'stops.txt', 'shapes.txt']);
  const parsed = new Map<string, CsvRecord[]>();
  for (const entry of archive.files.filter((candidate) => candidate.type === 'File')) {
    const name = entry.path.split('/').at(-1) ?? entry.path;
    if (!name.endsWith('.txt')) continue;
    const targetPath = join(rawOutput, name);
    if (required.has(name)) {
      const buffer = await entry.buffer();
      writeFileSync(targetPath, buffer);
      parsed.set(name, records(buffer));
    } else {
      await pipeline(entry.stream(), createWriteStream(targetPath));
    }
  }

  for (const name of required) {
    if (!parsed.has(name)) throw new Error(`Merged GTFS archive is missing ${name}.`);
  }

  const routeRecords = parsed.get('routes.txt') ?? [];
  const tripRecords = parsed.get('trips.txt') ?? [];
  const stopRecords = parsed.get('stops.txt') ?? [];
  const shapeRecords = parsed.get('shapes.txt') ?? [];
  const routeById = new Map(
    routeRecords.flatMap((route) => {
      const routeMode = mode(route.route_type);
      return routeMode ? [[route.route_id, { record: route, mode: routeMode }] as const] : [];
    })
  );
  const shapeRoute = new Map<string, string>();
  const shapeTrips = new Map<string, number>();
  const services = new Set<string>();
  for (const trip of tripRecords) {
    if (trip.shape_id && trip.route_id && !shapeRoute.has(trip.shape_id)) {
      shapeRoute.set(trip.shape_id, trip.route_id);
    }
    if (trip.shape_id) {
      shapeTrips.set(trip.shape_id, (shapeTrips.get(trip.shape_id) ?? 0) + 1);
    }
    if (trip.service_id) services.add(trip.service_id);
  }

  const shapePoints = new Map<string, Array<{ sequence: number; coordinate: Coordinate }>>();
  for (const point of shapeRecords) {
    if (!shapeRoute.has(point.shape_id)) continue;
    const longitude = Number(point.shape_pt_lon);
    const latitude = Number(point.shape_pt_lat);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    const points = shapePoints.get(point.shape_id) ?? [];
    points.push({
      sequence: Number(point.shape_pt_sequence),
      coordinate: [longitude, latitude],
    });
    shapePoints.set(point.shape_id, points);
  }

  const shapesByRoute = new Map<string, Array<{ path: Coordinate[]; trips: number }>>();
  for (const [shapeId, points] of shapePoints) {
    const routeId = shapeRoute.get(shapeId);
    if (!routeId || !routeById.has(routeId)) continue;
    const path = points
      .sort((left, right) => left.sequence - right.sequence)
      .map((point) => point.coordinate);
    const shapes = shapesByRoute.get(routeId) ?? [];
    shapes.push({ path, trips: shapeTrips.get(shapeId) ?? 0 });
    shapesByRoute.set(routeId, shapes);
  }

  const routes: TransitRoute[] = [...routeById].flatMap(([routeId, route]) => {
    const shapes = (shapesByRoute.get(routeId) ?? [])
      .filter((shape) => shape.path.length >= 2)
      .sort((left, right) => right.trips - left.trips || right.path.length - left.path.length);
    if (shapes.length === 0) return [];
    const knownNames = fixedGuidewayNames[routeId];
    const shortName = knownNames?.shortName || route.record.route_short_name || routeId;
    const routeColor = color(route.record.route_color, route.mode);
    return [{
      id: routeId,
      shortName,
      longName: knownNames?.longName || route.record.route_long_name || shortName,
      mode: route.mode,
      color: routeColor,
      textColor: textColor(route.record.route_text_color, routeColor),
      path: compactPath(shapes[0].path),
      paths: shapes.map((shape) => compactPath(shape.path, 240)),
    }];
  }).sort((left, right) => left.shortName.localeCompare(right.shortName, undefined, { numeric: true }));

  const stops: TransitStop[] = stopRecords.flatMap((stop) => {
    const longitude = Number(stop.stop_lon);
    const latitude = Number(stop.stop_lat);
    if (!stop.stop_id || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    return [{
      id: stop.stop_id,
      name: stop.stop_name || stop.stop_id,
      latitude,
      longitude,
      parentStation: stop.parent_station || undefined,
      wheelchairBoarding: stop.wheelchair_boarding || undefined,
    }];
  });

  const asset: StaticNetworkAsset = {
    generatedAt: new Date().toISOString(),
    sourceUrl,
    licenseUrl,
    routes,
    stops,
    statistics: {
      routes: routes.length,
      stops: stops.length,
      trips: tripRecords.length,
      services: services.size,
    },
  };
  mkdirSync(dirname(webOutput), { recursive: true });
  writeFileSync(webOutput, `${JSON.stringify(asset)}\n`, 'utf8');
  const indexedTrips = await buildGtfsScheduleIndex(
    join(rawOutput, 'stop_times.txt'),
    join(rawOutput, 'schedule-offsets.json')
  );
  console.log(
    `Static GTFS ready: ${routes.length} routes, ${stops.length} stops, ` +
      `${tripRecords.length} trips, ${services.size} service calendars.`
  );
  console.log(`Raw GTFS files: ${rawOutput}`);
  console.log(`Schedule index: ${indexedTrips} trips`);
  console.log(`Dashboard network asset: ${webOutput}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});