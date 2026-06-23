const ROUTE_ENTITY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[A-Za-z][A-Za-z0-9-]{0,31}_[A-Za-z0-9][A-Za-z0-9_-]{0,63})$/i;

export function isValidRouteEntityId(id: string | undefined): id is string {
  if (!id) return false;
  return ROUTE_ENTITY_ID_PATTERN.test(id);
}

// Series ids are either a slug (local mode) or a UUID (Postgres mode).
const SERIES_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9][a-z0-9-]{0,63})$/i;

export function isValidSeriesId(id: string | undefined): id is string {
  if (!id) return false;
  return SERIES_ID_PATTERN.test(id);
}
