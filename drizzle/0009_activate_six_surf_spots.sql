INSERT INTO `spots` (
  `id`, `slug`, `name_en`, `name_zh`, `region`, `latitude`, `longitude`,
  `coordinate_source`, `source_notes`, `active`, `created_at`, `updated_at`
) VALUES
  ('spot_suao-wuwei-harbor', 'suao-wuwei-harbor', 'Su''ao - Wuwei Harbor', '無尾', 'Northeast', 24.6114709, 121.867805, 'User-supplied coordinates', 'User supplied in product request on 2026-08-30', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_daxi', 'daxi', 'Daxi', '蜜月灣', 'Northeast', 24.9333608, 121.885568, 'User-supplied coordinates', 'User supplied in product request on 2026-08-30', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_jinzun', 'jinzun', 'Jinzun', '金樽', 'East', 22.9558919, 121.2942829, 'User-supplied coordinates', 'User supplied in product request on 2026-08-30', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_donghe', 'donghe', 'Donghe', '北東河', 'East', 22.976243201721132, 121.31300650318626, 'User-supplied coordinates', 'User supplied in product request on 2026-08-30', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_yuguangdao', 'yuguangdao', 'Yuguangdao', '漁光島', 'West', 22.980289143624113, 120.15516081806676, 'User-supplied coordinates', 'User supplied in product request on 2026-08-30', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_nanwan', 'nanwan', 'Nanwan', '南灣', 'South', 21.95878467673781, 120.76046672044414, 'User-supplied coordinates', 'User supplied in product request on 2026-08-30', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
