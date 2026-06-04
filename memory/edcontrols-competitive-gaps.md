---
name: edcontrols-competitive-gaps
description: Competitive analysis vs Ed Controls — the field-workflow features our app is missing
metadata:
  type: project
---

Ed Controls (edcontrols.nl/.com) is the main Dutch competitor — a snagging/quality/handover SaaS for the Wkb execution phase (162k users). Their product is three modules (Tickets, Audits, Dashboard) but their moat is the *field UX*, which is exactly where our BIM-heavy app is weak.

Their three signature moves (our gaps), ranked by impact:
1. **Drawing-pinned tickets** — every snag is a container (photo+text+docs+assignee) pinned to an (x,y) on an uploaded 2D drawing/PDF. We only link findings to IFC `global_id`, not to a drawing coordinate. This is their #1 differentiator and our biggest gap.
2. **Offline-first mobile** — native iOS/Android app; download project, snag with no internet, sync later. We have none (capture-link upload is online + anonymous). A PWA covers most of it.
3. **Digital oplevering + e-signature + one-click Wkb dossier** — most on-strategy gap: Wkb legally mandates an opleverdossier and we already own the hard parts (compliance engine, certificates, borgingsplan, risks) — we just don't assemble+sign+hand over.

Our moat they lack: 3D IFC viewer + automated BBL/WKB compliance engine. **The winning move is fusing the two**: pin a snag on a 2D drawing → auto-resolve the IFC element at that point → auto-tag the BBL/WKB article. Neither product has this.

Quick win: BCF backend (parser/generator/models/migration in `apps/api/src/bimstitch_api/bcf/`) is ~90% done but uncommitted with no API routes or viewer UI — wiring it up gives standard issue interop cheaply. See [[bcf-backend-status]].
