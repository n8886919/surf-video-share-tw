# CWA collection investigation — September 17, 2026

Read-only production audit at **22:35 Taipei September 17**. The owner reports daily CWA 3/4 results. Evidence: ignored `outputs/cwa-audit-2026-09-17.{mjs,json}`. All queries were SELECT or EXPLAIN; 11,383 rows read and **zero rows written**. No collection, notification, deployment or historical backfill was triggered.

## Confirmed findings

- Every September 10–16 report says CWA 3/4, near MFWAM 4/4 and far MFWAM 2/2. The retained completion ledger agrees for each date.
- Every one of those seven dates lacks the **08:00 Taipei CWA model run** (`00:00 UTC`). Both its completion and all forecast snapshots are absent. This is not the earlier MFWAM seconds-normalization defect or a completion received after report preparation.
- The bounded snapshot query uses `forecast_completion_run_idx`. These dates are still within the forecast retention protection window; normal expiry does not explain the absent batches.

September 16 evidence, all times Taipei:

| Model run | Stored upstream issue time | All-spot completion | Stored coverage |
| --- | --- | --- | --- |
| September 16 02:00 | September 16 08:49:33 | September 16 14:21:54 | 500 rows / 20 spots / 25 distinct leads |
| September 16 08:00 | Unknown; absent | Absent | 0 rows |
| September 16 14:00 | September 16 20:13:35 | September 16 20:21:55 | 500 rows / 20 spots / 25 distinct leads |
| September 16 20:00 | September 17 02:04:37 | September 17 02:21:52 | 500 rows / 20 spots / 25 distinct leads |

The report was prepared September 17 09:05:35. All three recorded completions preceded it. The missing fourth run was still absent at this audit.

The pattern is not a fixed three-runs-per-day identity restriction: September 17's 08:00 model run is present, issued at 14:32:04 and completed at 20:21:54. That date is incomplete at audit time and must not yet be described as 4/4.

## Code-backed scheduling weakness and limits

The sibling `surf-video-share-tw-cwa-ingestor/cwa_ingestor/src/scheduler.ts` schedules at Taipei 02:20/08:20/14:20/20:20. In `runner.ts`, a successful full replay also updates `lastSuccessAt`, clears the failure count and waits for the next six-hour slot. There is no check that `lastModelRunAt` advanced before sleeping. `stale_success` measures successful transfer age, so repeated old-run success can keep it quiet.

Seven retained 02:00 model runs for September 10–16 have upstream issue timestamps at 08:47–08:56, after 08:20. Six were first received at approximately 14:20; September 13 was received at 10:35. Yesterday's observed sequence is therefore compatible with a stale batch at 14:20 and a newer batch already replacing the missing 08:00 run by 20:20. **The intermediate upstream response and exact missing-run cause are not proven.** Official nonpublication, a download/process failure or pending work cannot be excluded without installed HA logs. The workspace has no configured Supervisor connection; the sibling checkout does not establish installed code or runtime state.

The initial request was for installed App logs around September 16 14:20–20:23 Taipei. The subsequently supplied September 10–13 sequence below supplies enough evidence to address the collector's repeated stale-success scheduling behavior; additional logs are no longer a prerequisite for this local correction. It still does not establish the precise publication/availability of September 16's missing upstream run.

### Owner-supplied HA screenshot

The screenshot supplied after the audit shows **September 17**, not September 16. Its visible metadata identifies the September 17 08:00 model run, upstream issue time 14:32:04, 75 forecast files and a forecast window ending September 20 08:00. At 20:21:55 the installed App reports `attempted=500`, `inserted=500`, `duplicates=0`, `resumedPending=false`, then schedules its next attempt for September 18 02:20. This corroborates the production receipt and proves that this particular attempt completed fresh ingestion rather than resuming pending work or replaying duplicate rows. It does not identify the installed version or show what happened at 14:20, whether a newer model was then available, or why September 16's 08:00 run was missed. The source issue timestamp is not proof of the exact time the public endpoint became available.

This example also shows why comparing only to the previously stored model run would be insufficient as a fix: a newly inserted run can still arrive almost six hours after its issue timestamp. A bounded freshness check needs an explicit collection-window policy rather than treating either `inserted > 0` or model advancement alone as timely coverage.

### Owner-supplied September 10–13 log sequence

The owner then pasted the installed App logs from September 10 08:20 through the beginning of September 14 02:20. September 10, 11 and 12 repeat the same sequence, with no failed attempt in the shown collection windows:

| Attempt (Taipei) | Returned model batch | Ingestion result | Next attempt |
| --- | --- | --- | --- |
| 08:20 | Previous day 20:00 | 475 duplicates, 0 inserted | 14:20 |
| 14:20 | Same day 02:00 | 475 inserted, 0 duplicates | 20:20 |
| 20:20 | Same day 14:00 | 475 inserted, 0 duplicates | Next day 02:20 |

All shown completions have `resumedPending=false`. On September 13, startup at 10:34:27 explicitly reports **App 0.6.1**, followed by completion of the 02:00 model at 10:36:30. The 14:20 attempt repeats all 500 rows of that model and still waits until 20:20, when the returned model is 14:00. This confirms the installed collector's missing follow-up on stale successful responses, including after the App upgrade. The earlier 05:xx restarts returned duplicate data but did not displace the shown 08:20/14:20/20:20 attempts. There is no evidence that those restarts caused these particular gaps.

The logs establish successful downloading/writing and the exact six-hour blind intervals. They do not prove that every unobserved upstream 08:00 model was published inside an interval. The correction addresses the demonstrated sampling weakness without assuming or reconstructing those missing publications.

## Reporting semantics and repair direction

The CWA ledger is keyed by exact upstream model run and counts each all-spot-complete run once. MFWAM counts successful scheduled collection slots, including unchanged content. Therefore the message's shared “含相同資料／不是官方發布新版本次數” sentence does not fully describe CWA. A repeated CWA run does not supply an additional daily success. The local Worker candidate now says `CWA 模型批次：應收錄 4 批，完整收錄 N 批`, with footer `CWA 同一模型批次只算一次；MFWAM 成功指全浪點收錄完成（含相同資料）。` Counting, immutable snapshots and frozen report/retry keys are unchanged. This copy is not yet deployed.

Local HA App **0.6.2** retains the four base :20 collections and targets the preceding six-hour model run (14:20 Taipei targets 08:00). This is an operational freshness target based on the observed roughly six-hour publication lag, not an official availability guarantee. A successful response below that target schedules a fixed +1-hour follow-up and, if still behind, a fixed +2-hour follow-up. A current/newer model returns to the next base slot. Exhausting the window emits `cwa_model_pending` with `followUp=exhausted`; it never fabricates success or downloads history. The same event with `followUp=waiting` makes stale transfer success visible. Fixed wall-clock follow-up times do not reset after startup or delayed completion. Existing startup downloads and exponential retries for actual transport/storage failures remain separate; pending work still drains before a new ZIP.

The bound is eight extra scheduled ZIP downloads per day, beyond four base attempts and existing startup/failure recovery. The observed roughly 59 MB archives imply at most roughly 472 MB/day of additional HA download traffic when every window uses both follow-ups; actual archive sizes vary. The official [CWA download instructions](https://opendata.cwa.gov.tw/devManual/insrtuction), checked September 17, document ETag/If-None-Match, but neither live validators nor installed conditional behavior were verified here. No speculative conditional-download behavior was introduced.

The candidate's tests cover the supplied stale/newly-inserted timing, both follow-ups, exhaustion, startup/clock boundaries, UTC/Taipei rollover and the twelve-scheduled-download daily ceiling. A mocked live-endpoint integration simulates a late 08:00 model becoming available at 14:32 and verifies collection at 15:20; a failed completion acknowledgement retries pending state without another ZIP. That simulated publication is explicitly a fixture, not a claim about the missing September 10/16 upstream data. Worker tests verify CWA replay deduplication and frozen old-wording report retries. No runtime publication, HA update, production write, LINE message or historical backfill occurred. See PROJECT_STATE for verification and the exact next task.
