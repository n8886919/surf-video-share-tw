INSERT INTO `spots` (
  `id`, `slug`, `name_en`, `name_zh`, `region`, `latitude`, `longitude`,
  `coordinate_source`, `source_notes`, `active`, `created_at`, `updated_at`
) VALUES (
  'spot_waipu-fishing-harbor', 'waipu-fishing-harbor', 'Waipu Fishing Harbor', '外埔',
  'West', 24.6506129, 120.7655767, 'User-supplied coordinates',
  'User supplied in product request on 2026-09-01', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
