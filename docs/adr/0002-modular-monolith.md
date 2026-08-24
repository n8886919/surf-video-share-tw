# ADR 0002: Modular monolith

Status: accepted

Deploy web and API together, but keep React, Hono, domain logic, DB access, and providers separated at code/API boundaries. Same origin simplifies cookies/CORS/deployment; boundaries permit later splitting without rewriting product logic.
