# Product

## Problem

Forecast numbers do not answer the practical question: when this spot previously had similar conditions, what did it actually look like? The product builds a same-spot library of short real-world observations.

## MVP

- Authenticated user selects a surf spot and a 5–60 second video captured today.
- Capture time is hinted from file metadata and confirmed on the same screen.
- Backend enforces today in `Asia/Taipei`, requests direct video upload, records a condition snapshot, and shows the observation.
- User sets a reusable public `display_id`, a default identity preference, and can change visibility per video.

## Main flows

Returning upload: open → 上傳浪況 → spot → video → confirm prefilled time → upload. The only required fields are spot, video, and capture time when metadata needs confirmation. The last spot is remembered on the device.

Records: 我的紀錄 → observation cards → toggle anonymous/public ID.

Forecast matching is the next milestone: spot → 今天/明天/後天/time → forecast plus same-spot historical matches.

## Non-goals

No forecast dashboard, historical backfill, arbitrary long videos, points, ads, payments, subscriptions, public search indexing, uploader GPS, machine-learned similarity, or copied SwellEye content.

## UX decisions

- Traditional Chinese and phone-first.
- No title, description, tags, rating, manual weather, or wizard.
- Optional identity override stays under 更多選項.
- Failures use plain-language recovery messages.
