# Security and privacy

- Complete videos are public. The upload screen states the CC0 consequences inline without an extra consent click, and every new upload stores the accepted terms version. Existing unversioned rows are not retroactively exposed as CC0.
- Missing spot/time records are owner-only and expire after seven days; public queries require `public_at`, ready status, spot, capture time, a terms version, and visible moderation state.
- Public output may include the uploader's chosen `display_id` only when that video's visibility flag is on. LINE subjects and internal user IDs are never selected.
- Upload requires authentication, ownership check, provider ID verification, 200 MB limit, and 5–60 second duration.
- Target user-entered data is limited to spot/time, public ID, favorite, identity visibility, an optional fun reaction, and one optional 100-character uploader supplement. No manual condition values, uploader GPS, additional subjective tags, or public reply threads. The two optional subjective values never affect matching.
- Production secrets stay server-side. Development mocks require explicit development flags.
- MVP moderation is trust-first: no per-video pre-publication review. Public reports are auditable but do not auto-hide content. Only the project administrator identified by `ADMIN_USER_ID` can list open reports and delist a video; ordinary uploader metadata edits cannot republish a delisted row.
- Reporting does not clear copyright, privacy, music, likeness, or minor-consent risks. Upload terms must put responsibility on the contributor, while legal/privacy/safety reports may still cause first-party delisting.

Before public rollout: add rate limiting, verify Stream signed playback or equivalent origin restrictions, run deterministic expiry deletion, configure the administrator, exercise reporting/delisting against staging, and add cost alarms.
