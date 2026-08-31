# Matching algorithm

本文件是彼日浪影相似度的完整、可重現規格。產品意圖仍以 [Project principles](PROJECT_PRINCIPLES.md) 與 [Product](PRODUCT.md) 為準；實際執行權威是 [`packages/domain/src/matching.ts`](../packages/domain/src/matching.ts)。任何分數行為變更都必須在同一個 change set 更新兩者，並通過 `tests/matching-doc.test.ts`。

Matching 回答的是：「同一浪點中，哪支歷史影片在影片時間的已選模型快照，最接近使用者選定時間的預報？」影片側優先使用一般 live forecast 稍後自然取得的近期 `historical_forecast`，缺少時才退回拍攝當時可得的 `forecast`。它不是浪質評分、機率、實況預測或推薦模型。

## Design goals

- 可解釋：每個來源、特徵差異、權重、coverage 與 swell 配對都可檢查。
- 時間誠信：未來 target 只能使用查詢當下已發布的 `forecast`；影片側的拍攝後資料只有在明確標為 `historical_forecast` 時可優先使用，不能冒充當時可見的未來預報。
- 來源獨立：CWA 與 MFWAM 的原始值不平均、不互補缺值；collect-only 模型完全不進分數。
- 缺值誠實：`null` 是未知，不是零；以 coverage 排除資料過少的偶然高分。
- 標籤無關：provider 的主／次湧浪標籤可能交換，應比較浪系本身。
- 決定性：相同輸入永遠得到相同配對、分數與排序。
- MVP 成本可控：保留簡單的固定權重距離，不以觀看數、反應或黑盒模型調權。

## End-to-end pipeline

一次 `/matches` 查詢依序執行：

1. 驗證同一正式浪點與可選的未來目標時間。
2. 對每個必要 provider/model 選出目標預報快照。
3. 只取同浪點、完整、ready、公開、接受現行條款且未下架的候選影片；目前 API 以拍攝時間由新到舊限制為 20 支。
4. 對每支影片、每個必要來源，優先選出近期 `historical_forecast`；沒有時才選拍攝當時可得的 `forecast`。
5. 在每個來源內獨立計算 coverage、距離、分數與 swell 配對。
6. 排除任何必要來源缺失或來源內 coverage 小於 50% 的影片。
7. 等權合成必要來源分數並排序。

另外回傳的 `timeWindowObservations` 是同浪點、以後端查詢時間往前兩小時的獨立未評分影片列；它不受所選預報時間影響、不執行本文件的距離計算，也不影響 `matches` 排名。

## Forecast snapshot selection

未來 target 選擇：

- 只接受 `snapshot_kind = forecast`。
- `issued_at <= queryNow`，且 `|valid_at - targetTime| <= 4 小時`。
- 先選 `issued_at` 最新，再選 `valid_at` 最接近 target，最後以 snapshot `id` 升冪決定。

歷史影片每個 provider/model 只選一列：

- `|valid_at - capturedAt| <= 4 小時`。
- 合格列可以是 `snapshot_kind = historical_forecast`，或 `issued_at <= capturedAt` 的 `forecast`。
- 先選 `historical_forecast`，再選有效時間最接近拍攝時間者、`issued_at` 較新者，最後以 snapshot `id` 升冪決定。

`historical_forecast` 只由同一個 Open-Meteo live Forecast endpoint 的 bounded `past_hours=6` 正常排程產生；系統不切換到舊 Historical Forecast mode，也不替舊影片任意回補。這種列可以在拍攝後取得，因為它的用途是保存較接近實況的影片時間模型估計；`snapshot_kind` 使它不可能進入未來 target 查詢。`lead_hours` 保留供追溯，但不要求 target 與 candidate 相同。

## Required sources

| 台北日曆日偏移 | 必要來源 | 合成方式 |
|---|---|---|
| 0–2 | CWA `cwa-wave-f-a0020-001` 與 Open-Meteo `meteofrance_wave` | 兩個通過 coverage 的來源分數各 50% |
| 3–4 | Open-Meteo `meteofrance_wave` | MFWAM 來源分數即最終分數 |

每個來源先用自己的 target／candidate forecast 計分。來源間不平均 feature，也不能用一個來源填補另一個來源的缺值。

完整來源角色由 `packages/domain/src/forecast-sources.ts` 定義並由測試同步：

<!-- FORECAST_SOURCE_TABLE_START -->
| Provider / model | Display name | Role | Swell semantics |
|---|---|---|---|
| `cwa / cwa-wave-f-a0020-001` | CWA | active | none |
| `open-meteo / meteofrance_wave` | Météo-France MFWAM | active | partitioned |
| `open-meteo / ecmwf_wam` | ECMWF WAM 9 km | collect-only | none |
| `open-meteo / ncep_gfswave016` | NOAA GFS Wave 0.16° | collect-only | partitioned |
| `open-meteo / dwd_gwam` | DWD GWAM | collect-only | total |
<!-- FORECAST_SOURCE_TABLE_END -->

## Feature weights and scales

以下表格由 `MATCH_WEIGHTS` 約束。Weight 是完整 target 中該特徵的最大預算；scale 只供非圓形特徵的線性正規化。方向欄使用 cosine circular distance，程式中的 scale `180` 不參與該公式。

<!-- MATCH_WEIGHTS_TABLE_START -->
| Field key | Weight | Scale | Distance |
|---|---:|---:|---|
| `swellHeight` | 1.25 | 2 | linear capped |
| `swellPeriod` | 1 | 12 | linear capped |
| `swellDirection` | 1.2 | 180 | cosine circular |
| `windSpeed` | 0.65 | 20 | linear capped |
| `windDirection` | 0.55 | 180 | cosine circular |
| `tideHeight` | 0.6 | 3 | linear capped |
| `waveHeight` | 0.8 | 3 | linear capped |
| `wavePeriod` | 0.55 | 15 | linear capped |
| `waveDirection` | 0.65 | 180 | cosine circular |
| `windWaveHeight` | 0.55 | 2 | linear capped |
| `windWavePeriod` | 0.35 | 10 | linear capped |
| `windWaveDirection` | 0.45 | 180 | cosine circular |
| `windGust` | 0.25 | 25 | linear capped |
| `tideSlope` | 0.35 | 1 | linear capped |
<!-- MATCH_WEIGHTS_TABLE_END -->

固定群組預算如下：

| 群組 | 欄位 | 完整 target 預算 |
|---|---|---:|
| 湧浪系統 | height、period、direction；主次浪共享 | 3.45 |
| 風 | speed、direction、gust | 1.45 |
| 潮汐 | height、slope | 0.95 |
| 總浪 | height、period、direction | 2.00 |
| 風浪 | height、period、direction | 1.35 |
| 合計 | 所有完整數值特徵 | 9.20 |

`tideState`、provider metadata、觀看數、上傳者補充、開心／不開心、收藏與公開名稱都不參與分數。

## Normalized feature difference

對非方向數值，target 值為 `a`、candidate 值為 `b`、表格 scale 為 `s`：

```text
linearDifference(a, b, s) = min(|a - b| / s, 1)
```

差距達到 scale 後固定為 1，不再增加懲罰。

方向先取最短圓形角差：

```text
angleDelta(a, b) = min(mod(|a - b|, 360), 360 - mod(|a - b|, 360))
circularDifference(a, b) = (1 - cos(angleDelta × π / 180)) / 2
```

因此 359° 與 1° 的角差是 2°；0°／10° 約為 `0.007596`，0°／90° 為 `0.5`，0°／180° 為 `1`。所有 normalized difference 都在 0–1。

## Unordered swell-system matching

主／次湧浪不是固定身份，而是最多兩個可能被 provider 重新排序的浪系。Target 和 candidate 的 component 只要 height、period、direction 任一欄是有限數值就存在。

### Target-side budget split

若 target component 有正的有限浪高 `h_i`：

```text
strength_i = h_i²
share_i = strength_i / Σ strength
```

若所有存在的 target component 都沒有正浪高，則平均分配 share。每個 target component 的三個湧浪特徵權重都乘上自己的 `share_i`。所以增加次湧浪只會重新分配固定的 3.45 湧浪預算，不會提高湧浪總權重。

例如 target 主浪 1.5 m、次浪 0.5 m：strength 為 2.25 與 0.25，share 為 90% 與 10%；方向權重分別是 `1.2 × 0.9 = 1.08` 與 `1.2 × 0.1 = 0.12`。

### Assignment search

演算法列舉 target component 到 candidate component 的所有一對一合法配對；target 可以不配對，但同一 candidate component 不能被使用兩次。每個 assignment 的 penalty 是：

- 已配對且雙方有值：`normalizedDifference × target feature weight × target share`。
- candidate 缺該值或 target 未配對：完整的 `target feature weight × target share`，相當於最大差距。

選擇順序為：

1. assignment penalty 最小。
2. penalty 相同時，實際有值的 matched weight 較大者優先。
3. 仍相同時，以 candidate 原始標籤組成的 key 做穩定字典排序；因此完全相同的主／次浪會固定選 identity pairing，而不是在請求間跳動。

選定結果以 `swellPairing` 回傳，例如：

```json
[
  { "target": "primary", "candidate": "secondary" },
  { "target": "secondary", "candidate": "primary" }
]
```

UI 直接呈現這份 assignment，保留 candidate provider 的原始主／次浪標籤，不自行重算或改名。

## Availability, matched weight, and coverage

`availableWeight` 只由 target 中存在的有限數值決定；target 缺值不進入分母。湧浪欄再乘 target component share。

`matchedWeight` 是 target 與選定 candidate pairing 中雙方都有有限數值的權重總和。Candidate 缺值不當成零，也不直接加入距離；它只降低 coverage：

```text
coverage = matchedWeight / availableWeight
```

Minimum source coverage: `0.5`。

每個必要來源必須各自達到 `coverage >= 0.5`。剛好 50% 可以進入排名；低於 50%、沒有 numeric overlap，或 target 完全沒有可用權重時不會成為該來源的有效 match。這表示一個只有一半欄位但其已知欄位完全相同的 candidate 可以得到來源分數 1，同時仍清楚回報 coverage 0.5；coverage gate 是防止稀疏資料誤導的獨立條件。

## Source score

對選定 pairing 與所有雙方都有值的 feature：

```text
distanceWeight = Σ(normalizedDifference_i × effectiveWeight_i)
distance = distanceWeight / matchedWeight
sourceScore = round6(1 - distance)
```

`effectiveWeight` 對一般 feature 就是表格 weight；對 swell feature 則再乘 target component share。來源分數位於 0–1，四捨五入到小數第六位。`1` 代表所有實際比較的欄位相同，`0` 代表它們都達到最大正規化差距；它不是發生機率或浪好壞評價。

### Worked source example

假設完整 target／candidate 的其他欄位都完全相同，target 主浪 1.5 m、次浪 0.5 m，且只有主浪方向相差 90°：

```text
主浪 share = 0.9
主浪方向 effectiveWeight = 1.2 × 0.9 = 1.08
90° circularDifference = 0.5
distanceWeight = 1.08 × 0.5 = 0.54
matchedWeight = 9.2
sourceScore = 1 - 0.54 / 9.2 = 0.9413043478… → 0.941304
coverage = 9.2 / 9.2 = 1
```

## Provider composition

`combineRequiredSourceScores` 先確認 required source key 非空且不重複，再要求每個必要來源都存在、分數與 coverage 有限、且各自通過 50% coverage。

通過後使用來源分數的等權算術平均：

```text
combinedScore = round6(Σ sourceScore / sourceCount)
combinedCoverage = Σ sourceCoverage / sourceCount
combinedAvailableWeight = Σ sourceAvailableWeight
combinedMatchedWeight = Σ sourceMatchedWeight
```

例如 CWA 來源分數 0.8、MFWAM 來源分數 0.4，綜合分數就是 0.6；不會因其中一個來源的 feature weight 或 coverage 較高而改變 50／50 分配。任一必要來源缺失或 coverage 不足，整支影片都不進該模式的排名。

## Deterministic ordering and response

- 來源內先按 `score` 降冪，再按 candidate `id` 升冪。
- API 合成後同樣先按綜合 `score` 降冪，再按 observation `id` 升冪。
- Domain 計分結果保留逐欄 `components`；公開 API 回傳每個來源自己的 `score`、`availableWeight`、`matchedWeight`、`coverage`、完整 target/candidate forecast 與 `swellPairing`，但不另暴露內部 component 陣列。
- 日偏移 0–2 的 `ranking` 是 `equal-cwa-mfwam-composite-historical-forecast`；日偏移 3–4 是 `mfwam-only-historical-forecast`。

目前 API 只把同浪點最新 20 支合格公開影片送入精確計分。因此單次 domain 計算固定很小，但更舊且可能更相似的影片不會被召回。資料量增加時應先改善 indexed candidate retrieval、歷史 snapshot 關聯與相同 spot/time 查詢快取，不應直接讓所有影片進入 brute-force ranking；這是候選召回策略，不改變本文件的來源內分數定義。

## Explicit non-inputs and limitations

- 不使用影片畫面辨識、觀看數、播放次數、收藏、上傳者身份、補充文字或開心／不開心反應。
- 不使用 observation、reanalysis 或 hindcast 覆寫 forecast；明確的 `historical_forecast` 是 live Forecast endpoint 的近期預報封存，不是上述資料。
- 不跨 provider 平均原始欄位，也不從另一來源補值。
- ECMWF WAM、GFS Wave 0.16° 與 DWD GWAM 只蒐集、保存並顯示，不參與目前 coverage、距離或來源合成。
- 不判斷浪好不好、不輸出信心機率、不承諾影片就是未來實況。
- 潮汐 `state` 目前只供顯示；分數只使用 `tideHeight` 與 `tideSlope`。
- 固定權重是可解釋基準，不是從使用者行為學得；若未來改權重、公式、coverage、來源合成或候選策略，必須另行驗證與記錄。

## Synchronization contract

`tests/matching-doc.test.ts` 在 `pnpm test`／`pnpm verify`／CI 中執行，並強制：

1. 本文件的 `MATCH_WEIGHTS` 表格必須與 TypeScript export 完全一致。
2. 文件中的 minimum coverage 必須與 `MIN_MATCH_COVERAGE` 一致。
3. `matching.ts` 正規化內容的 SHA-256 必須與下方 marker 相同；任何程式碼、常數或排序行為改動都會使測試失敗，要求同一 change set 重新審查並更新本文件。
4. Forecast source table 必須與 `packages/domain/src/forecast-sources.ts` 完全一致。
5. README、Project principles、Product、Architecture、API 與 `matching.ts` 必須直接引用本文件。

更新流程：先修改 `matching.ts` 與相關測試，再同步修訂本文件的解釋／算例／表格，最後以測試失敗顯示的新 SHA-256 取代 marker。只更新 fingerprint、不審查內容不算完成 code review。

<!-- matching-source-sha256: 1739415792f8b00da34beb77856a9d6068f2db0322db65ac13202d1466576e55 -->
