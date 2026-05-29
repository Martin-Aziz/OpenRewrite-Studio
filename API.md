# API Documentation

Base URL: `http://localhost:8080`

All responses use JSON. Local MVP endpoints are unauthenticated for fast self-hosted evaluation; production deployments should add JWT/OIDC middleware as described in `DECISIONS.md`.

## POST /v1/rewrite

Rewrite text and return transparent sentence diffs plus evaluation signals.

```json
{
  "text": "It is important to note that our team will utilize this tool.",
  "mode": "natural",
  "tone": "warm",
  "strength": 62,
  "meaningLock": true,
  "provider": "local"
}
```

Responses:

- `200 OK`: rewrite result.
- `400 Bad Request`: validation error.
- `502 Bad Gateway`: AI service unavailable or invalid provider response.

## GET /v1/rewrite-sessions

Returns recent sessions in reverse chronological order.

## GET /v1/rewrite-sessions/:id

Returns one saved rewrite session.

## POST /v1/rewrite-sessions/:id/accept

Marks the latest version as accepted.

## Presets

- `GET /v1/presets`
- `POST /v1/presets`
- `PATCH /v1/presets/:id`
- `DELETE /v1/presets/:id`

## POST /v1/evaluate

Evaluate original and rewritten text without creating a rewrite session.

## API Keys

- `POST /v1/api-keys`
- `DELETE /v1/api-keys/:id`

## Error Shape

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "text is required",
    "details": {
      "field": "text"
    }
  }
}
```
