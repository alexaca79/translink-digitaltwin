export interface EventstreamConfig {
  brokers: string[];
  topic: string;
  username: string;
  password: string;
}

export interface KqlQueryConfig {
  queryUri: string;
  database: string;
}

export interface RealtimeFeedConfig {
  apiKey: string;
  alertsUrl: string;
  positionsUrl: string;
  tripsUrl: string;
}

export interface PublisherConfig {
  feeds: RealtimeFeedConfig;
  staticGtfsDirectory: string;
  pollIntervalMs: number;
  port: number;
  allowedOrigin: string;
  logEvents: boolean;
  requestsPerMinute: number;
  exposeErrorDetail: boolean;
  eventstream: EventstreamConfig | null;
  kql: KqlQueryConfig | null;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Zero disables throttling, so this accepts non-negative values. */
function nonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadConfig(environment = process.env): PublisherConfig {
  const brokers = environment.FABRIC_EVENTSTREAM_BROKERS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  const topic = environment.FABRIC_EVENTSTREAM_TOPIC?.trim() ?? '';
  const username = environment.FABRIC_EVENTSTREAM_USERNAME?.trim() ?? '';
  const password = environment.FABRIC_EVENTSTREAM_PASSWORD ?? '';
  const suppliedEventstreamFields = [brokers.length > 0, Boolean(topic), Boolean(username), Boolean(password)];
  const eventstreamConfigured = suppliedEventstreamFields.every(Boolean);

  if (!eventstreamConfigured && suppliedEventstreamFields.some(Boolean)) {
    throw new Error(
      'Fabric Eventstream configuration is incomplete. Set brokers, topic, username, and password together.'
    );
  }

  const kqlQueryUri = environment.FABRIC_KQL_QUERY_URI?.trim() ?? '';
  const kqlDatabase = environment.FABRIC_KQL_DATABASE?.trim() || 'TransLinkOperations';
  const apiKey = environment.TRANSLINK_API_KEY?.trim() ?? '';

  if (!apiKey) {
    throw new Error('TRANSLINK_API_KEY is required for TransLink GTFS-realtime.');
  }

  return {
    feeds: {
      apiKey,
      alertsUrl: environment.TRANSLINK_GTFS_ALERTS_URL
        ?? 'https://gtfsapi.translink.ca/v3/gtfsalerts',
      positionsUrl: environment.TRANSLINK_GTFS_POSITIONS_URL
        ?? 'https://gtfsapi.translink.ca/v3/gtfsposition',
      tripsUrl: environment.TRANSLINK_GTFS_TRIPS_URL
        ?? 'https://gtfsapi.translink.ca/v3/gtfsrealtime',
    },
    staticGtfsDirectory: environment.TRANSLINK_GTFS_STATIC_DIR ?? 'data/gtfs-static',
    pollIntervalMs: positiveInteger(environment.TRANSLINK_POLL_INTERVAL_MS, 15_000),
    port: positiveInteger(environment.PORT, 7071),
    allowedOrigin: environment.PUBLISHER_ALLOWED_ORIGIN ?? '*',
    logEvents: environment.PUBLISHER_LOG_EVENTS === 'true',
    requestsPerMinute: nonNegativeInteger(environment.PUBLISHER_RATE_LIMIT_PER_MINUTE, 60),
    exposeErrorDetail: environment.PUBLISHER_EXPOSE_ERROR_DETAIL === 'true',
    eventstream: eventstreamConfigured ? { brokers, topic, username, password } : null,
    kql: kqlQueryUri ? { queryUri: kqlQueryUri, database: kqlDatabase } : null,
  };
}