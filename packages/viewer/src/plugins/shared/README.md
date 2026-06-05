# `plugins/shared/`

Reserved for **cross-mode** plugin code — helpers or plugins that genuinely
apply to more than one engine (3D `ViewerContext` *and* PDF `DocumentContext`).

It is intentionally empty for now. Mode-specific code lives under:

- `plugins/3d/` — 3D/IFC viewer plugins (and `plugins/3d/shared/` for their
  three.js-only shared utilities: edges, css2d-overlay, clipping, outline-cache).
- `plugins/2d/` — 2D document plugins (PDF today; `plugins/2d/shared/` when a
  second 2D plugin needs a shared helper).

Do not put three.js- or pdf.js-coupled code here — that belongs in the
mode-specific buckets above.
