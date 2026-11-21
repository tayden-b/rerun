# Task: Rerun — design pass on the dashboard + README GIF and screenshots

Repo: https://github.com/tayden-b/rerun — branch `work/w2d-design` off `dev`, PR into `dev`.
Read `AGENTS.md`, `handoff/SPEC.md` §7, and the merged UI (`app/`, `components/`) first. Git identity: Tayden Barretto <taydenpbarretto@gmail.com> (repo-local). No credentials; demo mode only.

## Owned paths
`app/**` (excluding `app/api/**`), `components/**`, `lib/ui/**`, `public/**`, `docs/media/**`, `test/ui/__screenshots__/**`.

## Required behaviour
1. `npm run demo`; screenshot `/` and `/incidents/<id>` for each status (awaiting_approval, resolved, needs_human, an in-progress one) at 1280×800. Review them as a product designer against SPEC §7 and this bar: modern, clean, professional — Vercel dashboard / Linear / devin.ai. Never "AI-generated": no chip walls, no terminal cosplay outside the Verification block, no bold-text walls, no marketing taglines, no emoji, no gratuitous gradients/glows.
2. Fix spacing (one spacing scale), hierarchy (one clear primary action — Approve — per page), contrast (WCAG AA for text on the dark background), typography (one sans + one mono, consistent sizes), motion (subtle, ≤200ms, respects `prefers-reduced-motion`). Remove anything not needed. **No new features.**
3. Record the README GIF: demo mode, 1280×800, ≤20 s, ≤8 MB: list → open the incident → triage bars → expand a Subagent → diff → verification → Approve → resolved. Save `docs/media/rerun.gif` and stills `docs/media/{list,war-room}.png`. Update `test/ui/__screenshots__/`.
4. Put before/after screenshots in the PR description.

## Done
PR title `W2-D: dashboard design pass, README GIF`. Do not merge. Report: PR URL, CI, before/after screenshots, the GIF path and size.
