/** Shared by matching and its lightweight freshness preview. Same row ordering and bounds. */
export const TARGET_FORECAST_SQL = `SELECT * FROM (
  SELECT fs.*,
    ABS(strftime('%s', valid_at) - strftime('%s', ?)) AS valid_distance_seconds,
    ROW_NUMBER() OVER (
    PARTITION BY provider, model
    ORDER BY issued_at DESC,
      ABS(strftime('%s', valid_at) - strftime('%s', ?)), id
  ) AS source_rank
  FROM forecast_snapshots fs
  WHERE spot_id = ? AND snapshot_kind = 'forecast' AND issued_at <= ?
    AND CAST(strftime('%s', valid_at) AS INTEGER)
      BETWEEN CAST(strftime('%s', ?) AS INTEGER) - 14400
          AND CAST(strftime('%s', ?) AS INTEGER) + 14400
) WHERE source_rank = 1 LIMIT 8`;
