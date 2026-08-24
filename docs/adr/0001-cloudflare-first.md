# ADR 0001: Cloudflare-first architecture

Status: accepted

Use Workers, D1, and Stream. This avoids an always-on server and keeps the ≤100-user side project operationally small. Revisit only if measured cost, provider lock-in, or missing capability becomes material.
