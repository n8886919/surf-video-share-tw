# ADR 0003: Cloudflare Stream for MVP video

Status: accepted

Use direct creator uploads and store only provider IDs/metadata in D1. Video bytes never proxy through the Worker. This avoids operating FFmpeg/transcoding infrastructure. `VideoProvider` preserves an exit path.
