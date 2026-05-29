# OpenRewrite Desktop

This is the Tauri shell for OpenRewrite Studio. It reuses the web studio rather than creating a second UI.

## Development

From the repo root:

```bash
npm run dev
cd desktop
npm install
npm run dev
```

The desktop app loads `http://localhost:3000` during development.

## Production Direction

The Tauri shell is intentionally thin:

- Web UI remains the source of truth.
- Rust commands expose local service health and desktop configuration.
- Future work can add a global shortcut, tray menu, and selected-text rewrite flow.
