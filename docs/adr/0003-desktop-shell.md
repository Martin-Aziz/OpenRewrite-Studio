# ADR 0003: Use Tauri as a Thin Desktop Shell

## Status

Accepted

## Context

OpenRewrite Studio benefits from a desktop install path for local Ollama workflows, global shortcuts, selected-text rewriting, and tray/menu-bar access. Building a separate desktop product would duplicate UI and slow iteration.

## Decision

Use Tauri as a thin Rust shell around the existing web studio. In development it loads `http://localhost:3000`; production builds use a static Next export. Rust commands expose desktop configuration and local service health.

## Consequences

The browser app remains the primary product surface. Desktop-specific features can be added incrementally without splitting the product architecture.
