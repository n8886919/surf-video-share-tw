# Data sources

Last verified: 2026-08-24. Re-verify official documentation before implementing or monetizing; this file does not assert unreviewed commercial licensing.

| Purpose | Provider / product | Variables or API | License / commercial concern | Historical | Forecast | Fallback |
|---|---|---|---|---|---|---|
| Video upload/transcode/delivery | Cloudflare Stream | Direct creator uploads; video details | Paid service terms and UGC handling require review | Stored app videos | n/a | Future `VideoProvider` implementation |
| Marine conditions | Open-Meteo Marine API | wave/swell height, direction, period; secondary swell | Pricing/license/attribution must be reviewed for actual usage tier | Provider-dependent | Yes | Future alternate marine provider |
| Tide | Taiwan CWA, product/endpoint unresolved | tide height/state | API dataset terms and coastal-datum meaning must be verified before code | TODO | TODO | Keep nullable or alternate public source |
| Authentication | LINE Login v2.1 | OAuth authorization code + OIDC | Platform terms apply; request only needed scopes | n/a | n/a | None in production; fail closed |
| Spot geography | User-supplied Google Maps place | 烏石港 at 24.8731036, 121.8411446 | Used only as location provenance; no copied descriptions or media | n/a | n/a | Keep spot inactive until verified |
| Spot names checklist only | Public SwellEye guide names supplied in project brief | Names only | No crawling or copied descriptions/media/forecast/proprietary metadata | n/a | n/a | Manual checklist |

Official references:

- Cloudflare Stream direct creator uploads: https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
- Open-Meteo Marine API: https://open-meteo.com/en/docs/marine-weather-api
- LINE Login web integration: https://developers.line.biz/en/docs/line-login/integrate-line-login/
- 烏石港 source point: https://maps.app.goo.gl/4SENnqZuYGGe8Gco7

Only 烏石港 is verified and active. Coordinates and Chinese names for the remaining checklist spots intentionally remain blank and inactive until independently verified with recorded provenance.
