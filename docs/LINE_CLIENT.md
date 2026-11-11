# LINE client — implementation brief

Updated: 2026-11-11. Signed webhook, durable drafts and queued transfer are implemented locally; production intake remains disabled pending credentials and real transfer acceptance.

## Implementation and first sample

`POST /api/v1/line/webhook` verifies the raw-body signature and expected bot destination, then acknowledges durable enqueue without waiting on downloads or replies (LINE's deadline is two seconds). A private event queue feeds replies independently of the video-transfer queue. Both consumers run in the existing Worker. Event messages contain only validated fields, including private LINE identity and short-lived reply tokens; configure one-day retention and never log/export their bodies. Transfer jobs contain only a draft UUID.

`line_upload_drafts` persists owner, source message ID, revision, capture fields, seven-day expiry, private provider ticket and a short transfer lease. Duplicate source messages converge on one draft; buttons require owner/revision/status compare-and-set. Unsend creates a tombstone even before original-message delivery and immediately removes public visibility. Shared user registration preserves existing web profiles and the 100-user cap. It does not establish a browser session: web access still uses LINE Login.

LINE bytes stream into a private Stream multipart upload with actual-byte counting, without buffering a whole video. Only a successful complete transfer creates a normal video row through the same insertion service as the website. Stable IDs/leases prevent duplicate videos; uncertain interrupted transfers delete the old private asset before retrying, with at most three full transfer attempts. Shared provider-duration validation and completion control publication. Existing hourly maintenance recovers missed jobs and reclaims expired/failed private assets in bounded batches.

Metadata prefill uses a best-effort two-second/four-MiB prefix inspection. Explicit recording timestamps and precise, unambiguous GPS may suggest fields; tail-only metadata remains unknown. Container time, message time and current location are never fallbacks. The website's bounded random-access parser was moved unchanged into the domain package and re-exported at its old path.

One owner-provided video was received and downloaded through Official Account Manager with the owner's assistance. It had no supported explicit recording timestamp or GPS, and its container time did not match the owner's stated capture time. The file included Android-related container metadata. This does not establish whether Google Photos, LINE, or another step changed the timestamp, and it does not prove Messaging API content is byte-identical to the Manager download. No percentage success rate can be inferred. The test media stays local and is not a public surf observation.

`node ops/compare-line-video-metadata.mjs "received.mp4"` reports presence only. Supply `"original.mp4" "received.mp4"` to compare preservation. The tool reads bounded metadata, omits file names, timestamps and coordinates from its output, and never uploads files. Exact sample details and logs belong only in ignored local work files.

Validation uses migrated SQLite and mocked provider HTTP for duplicates, missing fields, owner/revision checks, repeated confirmation, transfer interruption/retry, provider duration, unsend before receipt/during transfer/after publication and expiry cleanup. Final full-suite results are recorded in PROJECT_STATE. Mocks do not establish real LINE/Stream interoperability. Runtime credentials, an actual private transfer and phone acceptance are still required.

Completion currently uses **查看進度 / 我的影片** reply buttons, preserving the free push allowance. Sending a non-video message recovers the latest available card if a reply was missed. `/?view=mine` opens the shared owner view. Automatic completion push, targeted recommendations, rich menu and watermark rendering remain later steps after real upload acceptance.

## Account setup verified

The new public-facing Official Account is **彼日浪影**, **@792vlmeo**, on the Taiwan light/free plan (dashboard allowance: 200). Its profile image is the existing `public/brand-logo.png`, published and visually checked. Messaging API is enabled under the same Provider as the existing published LINE Login channel. The Login channel still displays its older name 「浪影互助」; its ID matches `LINE_CHANNEL_ID` in the reviewed Wrangler configuration. The existing owner-only system-notification Official Account is separate.

The owner requested a warm yellow background for the system-notification account's avatar to distinguish the two accounts. `assets/line/ops-avatar.png` was generated from the existing Logo, uploaded, published and visually verified on 2026-11-11. The prompt is recorded alongside the asset. The customer-facing account uses the original teal variant.

No webhook endpoint, runtime Messaging credential, automatic upload processing, LIFF app, rich menu, or broadcast was deployed as part of this account setup. Account creation and API activation are not an end-to-end bot test. Keep channel secrets, raw LINE subjects and contact email out of this public repository.

For a smooth shared identity, map signed Messaging events and verified Login identities through the same existing internal user service. LINE issues the same user ID for channels under the same Provider; do not create a second user table or trust a client-submitted subject. Missing identities must receive an explicit recovery flow instead of being guessed. Existing user limits and consent still apply.

## Confirmed interaction

LINE is one client of the shared service, alongside the existing web client. Both shoreline-condition videos and personal surfing clips are in scope, subject to existing public contribution rules. The owner reports that users forget or do not want to open the app. Start with the free LINE plan and retain the NT$1,000 monthly total budget.

The latest owner decision supersedes silence-as-confirmation, a timed correction window, and correction-until-next-upload. The user sends a video in the chat, sees capture time and spot, optionally changes either through buttons, then explicitly presses **確認上傳**. Do not display 「時間、地點正確嗎？」 or 「不用回覆，我會自動採用；有誤請點下方更改。」.

Example card:

```text
拍攝時間：11/11 08:32
浪點：烏石港

[確認上傳] [更改浪點] [更改時間]
```

The normal interaction takes one confirmation after sending the video. Correction does not require typing. Confirmation changes the draft to processing; subsequent taps return its existing status. The progress button returns the result with a link to the shared owner view; automatic completion push and share derivatives remain later steps. Opening the website shows the same user's videos. Planned rich-menu navigation: 找影片 / 我的影片 / 上傳說明. Avoid forced app switching, a second registration, and separate client-specific business rules.

Use a persistent Flex Message card for these actions. Quick reply buttons may disappear when another message arrives, so they must not be the sole way to return to a draft. Date/time uses the LINE datetime picker interpreted explicitly in Asia/Taipei; spot uses the existing active list with recent choices or pagination (20 spots exceed the 13 quick reply limit). Missing metadata remains unknown and requires selection before confirmation; never silently treat message time or current location as capture metadata.

## Shared backend boundary

1. A signed LINE webhook creates a private intake draft, identified independently for each message/video. Verify the raw-body signature before parsing; deduplicate webhook events and handle out-of-order delivery, unsend and retries.
2. Retrieve received content promptly: LINE does not promise indefinite content retention. Verify the practical content-transfer and metadata-preservation path before committing to a storage design. Browser video bytes continue going directly to Stream; LINE ingestion needs a provider adapter and must not buffer a 200 MB file in Worker memory or expose LINE tokens in fetch URLs.
3. Parse supported metadata and retain its source, then render the editable card. Unconfirmed drafts stay private and expire within the existing seven-day maximum; earlier provider deletion may require re-upload. Do not persist raw GPS as a product field.
4. Confirmation revalidates ownership, latest draft revision, spot, captured-at age <=168 hours, no future dates, Taipei capture hours, licence acceptance, size and duration. Repeated confirmation must be idempotent. Display the existing public/CC0 disclosure before this action and record the accepted terms version; do not add another mandatory checkbox.
5. Create/finalize through shared application services. Confirmed time and spot stay fixed, preserving current API and forecast-retention assumptions. Drafts are separate from published videos; latest-card clicks must never change another draft.
6. Keep provider/model snapshots independent. Generate a share version with date/time/spot and clearly labelled model wave height/direction; missing values stay missing. Preserve the source version and provenance. Delivery and rendering are asynchronous, with bounded retries and quota checks.

The current `updateVideoSchema` is strict and accepts no spot or capture-time change. The proposed next-upload correction feature would have required changes to this contract, forecast retention and derivative versioning. It is withdrawn; do not implement it.

## Capabilities worth using

| Capability | Project use | Priority / constraint |
| --- | --- | --- |
| Messaging API video events and content retrieval | Receive videos directly in chat | First; actual metadata retention must be tested |
| Flex Message + postback | Compact capture card, confirm and spot buttons | First; backend rechecks draft ownership/revision |
| Datetime picker | Change capture time without typing | First; explicit Taipei interpretation |
| Rich menu | 找影片 / 我的影片 / 上傳說明 | First; link to shared web surfaces |
| Reply messages | Acknowledge upload, choices and confirmation | First; replies do not consume the monthly message quota, but reply tokens are short-lived and single-use |
| Push / multicast | Deliver finished video and selected useful clips | Budgeted; async completion may require a counted push |
| LINE Login add-friend option | Connect existing web users with the official account | Same Provider as existing Login channel |
| LIFF | Open existing web functions inside LINE | Later, only where native chat controls are insufficient |
| LIFF shareTargetPicker | User explicitly shares their result to friends/groups | Later; no OpenChat, availability checks and channel setup required |
| Follow / unfollow events | Welcome and stop notifications after blocking | First; keep preferences in the shared backend |

Do not add points, coupons, paid memberships, ads, public comments or a separate LINE-only video database. No automatic recipient messaging is authorized by merely creating the account.

## Verification before enabling intake

- Compare known original iPhone/Android files with their received LINE versions. Measure time detection, spot suggestion, and both-correct rates separately. Synthetic parser unit tests do not establish a field success rate.
- Exercise duplicate/out-of-order webhooks, concurrent cards, wrong-owner postbacks, expired drafts, double confirmation and failed content retrieval.
- Confirm final duration using the video provider, and test invalid/future/older-than-168-hour capture values at confirmation.
- Verify public/private lifecycle, model provenance, render retries and message quota handling.
- Run `pnpm verify` before releasing cross-cutting API/auth/schema/provider changes.

## Official references (checked 2026-11-11)

- [Bot setup and one webhook endpoint per channel](https://developers.line.biz/en/docs/messaging-api/building-bot/)
- [Receiving messages, content retrieval and redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [Actions and datetime picker](https://developers.line.biz/en/docs/messaging-api/actions/)
- [Quick replies and their lifecycle](https://developers.line.biz/en/docs/messaging-api/using-quick-reply/)
- [Rich menus](https://developers.line.biz/en/docs/messaging-api/using-rich-menus/)
- [Messaging API message counting](https://developers.line.biz/en/docs/messaging-api/pricing/)
- [Provider design](https://developers.line.biz/en/tips/2026/06/25/provider-design-basics/)
- [Login add-friend option](https://developers.line.biz/en/docs/line-login/link-a-bot/)
- [LIFF sharing](https://developers.line.biz/en/docs/liff/developing-liff-apps/)
- [LIFF API reference](https://developers.line.biz/en/reference/liff/)
