UPDATE `spots`
SET `active` = 0, `updated_at` = CURRENT_TIMESTAMP;
--> statement-breakpoint
INSERT INTO `spots` (
  `id`, `slug`, `name_en`, `name_zh`, `region`, `latitude`, `longitude`,
  `coordinate_source`, `source_notes`, `active`, `created_at`, `updated_at`
) VALUES (
  'spot_wushi-harbor-north',
  'wushi-harbor-north',
  'Wushi Harbor',
  '烏石港',
  'Northeast',
  24.8731036,
  121.8411446,
  'https://maps.app.goo.gl/4SENnqZuYGGe8Gco7',
  'Google Maps listing 烏石港北堤衝浪點; product display name 烏石港',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(`slug`) DO UPDATE SET
  `name_en` = excluded.`name_en`,
  `name_zh` = excluded.`name_zh`,
  `region` = excluded.`region`,
  `latitude` = excluded.`latitude`,
  `longitude` = excluded.`longitude`,
  `coordinate_source` = excluded.`coordinate_source`,
  `source_notes` = excluded.`source_notes`,
  `active` = excluded.`active`,
  `updated_at` = excluded.`updated_at`;
