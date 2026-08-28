# Data model

```mermaid
erDiagram
  USERS ||--o{ VIDEOS : uploads
  SPOTS ||--o{ VIDEOS : tagged_at
  CONDITION_SNAPSHOTS ||--o{ VIDEOS : actual_context
  SPOTS ||--o{ FORECAST_SNAPSHOTS : forecast_for
```

`users.line_display_name` is the latest LINE-provided display name and remains a private suggestion. It is distinct from the user-confirmed public name in `users.display_id`; public queries never select the LINE subject or LINE display-name suggestion.

Internal testing is capped at 100 `users` rows. Existing LINE subjects remain eligible at capacity; registration uses a conditional insert against the current row count so a rejected user creates no row or session. This is an application policy and requires no additional public identity field.

`videos.spot_id` and `captured_at` are nullable during the seven-day private pending period. `metadata_status`, `metadata_expires_at`, and `public_at` make the lifecycle explicit. `terms_version` prevents silently applying CC0 to older uploads. `moderation_status`/`delisted_at` stop a delisted row from being republished by ordinary metadata changes. `is_favorite` is owner-private; `uploader_note`, `fun_reaction`, and the chosen public name may be public only after completion.

`video_reports` stores a public report reason and its open/resolved lifecycle. A configured administrator can resolve all open reports for one video and delist it in one D1 batch; a report alone never automatically hides media.

`problem_reports` is separate from media moderation. It stores only a 5–300 character problem description, the submitting UI view, open/resolved timestamps, and the resolving administrator's internal ID. It intentionally stores no reporter user ID, LINE data, contact detail, or network address.

`condition_snapshots` describes capture-time context when a provider is available. Missing context is valid and never blocks a completed video.

`forecast_snapshots` stores immutable provider/model/run/valid/lead/grid rows. Total wave, primary/secondary swell, wind wave, tide, wind, and gust fields are nullable because a provider may omit components. A unique source key prevents duplicate ingestion while never averaging models.

All instants are UTC ISO strings. Product validation compares exact elapsed time; display uses `Asia/Taipei`.
