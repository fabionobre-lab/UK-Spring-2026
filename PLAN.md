# Zarparia — open work

> Family-standard plan file (checkbox format per
> `C:\AI\AriaNobre\FAMILY-STANDARDS.md` §0.6). History:
> `LAUNCH_PLAN.md` (launch phases 0–6 shipped, soft-launched at £0/mo) and
> `PLATFORM_PLAN.md` (platform phases A–G shipped). Public user-facing
> roadmap: in-app `/roadmap` (`web/src/lib/roadmap/roadmap.json`,
> admin-triaged). Only open work lives here. Last reviewed: 2026-08-06.

## Paid tail (LAUNCH_PLAN Phase 7 — when Fabio green-lights spend)

- [ ] **Custom domain** (~£10/yr) — also unblocks family-wide worker CORS,
      shared mailer and branded email auth (family P5).
- [ ] **Cloudflare WAF** on the custom domain.
- [ ] **Transactional email** (replaces mailto + in-app pending-invite flow).
- [ ] **ICO registration** (~£60/yr) if the beta opens beyond the household.

## Family program items landing in this app

- [ ] **Passkeys** on the shared login shell (family consistency program,
      open since round 2).
- [x] **Feedback → roadmap flow** (family P4) — done 2026-08-06. Triage at
      `/admin/roadmap`: accept a submission into a bilingual roadmap entry, or
      dismiss it. `roadmap.json` is now the committed base snapshot; the D1
      `roadmap_items` table (migration 0014) is the admin overlay merged over
      it per request, so publishing needs no code edit and no deploy.
