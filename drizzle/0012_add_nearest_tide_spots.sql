INSERT INTO `spots` (
  `id`, `slug`, `name_en`, `name_zh`, `region`, `latitude`, `longitude`,
  `coordinate_source`, `source_notes`, `active`, `created_at`, `updated_at`
) VALUES
  ('spot_zhongjiao-bay', 'zhongjiao-bay', '中角灣', '中角灣', 'North', 25.239770, 121.633917, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_fulong', 'fulong', 'Fulong', '福隆', 'North', 25.01950696642004, 121.94721228977903, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_environmental-park', 'environmental-park', 'Environmental Park', '環保', 'East', 24.00893745298168, 121.64634373339165, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_hualien-beibin', 'hualien-beibin', 'Hualien Beibin', '北濱', 'East', 23.976851157405616, 121.62119607489474, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_jiqi', 'jiqi', 'Jiqi', '磯崎', 'East', 23.707389208134664, 121.54972184939969, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_jiupeng', 'jiupeng', 'Jiupeng', '九棚', 'South', 22.10902017243464, 120.89123362409177, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_jialeshui', 'jialeshui', 'Jialeshui', '佳樂水', 'South', 21.98728982582793, 120.84633938560528, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_nanwan', 'nanwan', 'Nanwan', '南灣', 'South', 21.958931664298785, 120.76328410357425, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_songbai-harbor', 'songbai-harbor', 'Songbai Harbor', '松柏港', 'West', 24.431933375413898, 120.61715426605767, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_green-bay', 'green-bay', 'Green Bay', '翡翠灣', 'North', 25.1883162, 121.6652802, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spot_wanli', 'wanli', 'Wanli', '萬里', 'North', 25.181926, 121.6875599, 'User-supplied coordinates', 'User supplied in product request on 2026-08-31', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
