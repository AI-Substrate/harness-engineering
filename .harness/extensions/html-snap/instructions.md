# html-snap — agent briefing

You are the calling agent. This verb gives you **pixel truth about an HTML file** without a live browser session: it renders the file in headless system Chrome (reduced-motion forced, virtual-time bounded) and hands you PNG paths you can read as images. You bring the judgement: what to snap, which regions to inspect, and what the pixels mean.

## What the verb computes deterministically

- A settled render at `--width × --page-height` (defaults 1440×14000). Pages using a `prefers-reduced-motion` settle path (e.g. the `--p`/window beat engine in the 065 infographic) render their **finished frames** — you are judging final compositions, not mid-tween accidents.
- Optionally one crop (`--offset <y> --crop-height <h>`) or `--slices N` even bands — sized for image-reading (a 14000px full page is too tall to read well; slices of ~1500–2000px read best).
- Loud, typed failure on every known-bad shape: missing file, invalid crop geometry, forced-but-missing `HTML_SNAP_CHROME`, no browser found (probed list named), crash, or a screenshot-shaped empty file. **If you get an `ok` envelope, the PNGs are real renders.** Never treat a non-ok envelope as "probably fine".

## Your role

1. Prefer `--slices 6..10` for whole-page review; use `--offset/--crop-height` to zoom a defect once you've located its band.
2. Read the PNGs with your image tool and *describe what a human would see* — overlaps, clipped text, mis-positioned elements, horizontal overflow, broken alignment.
3. Report defects with their band offset (`slice 3 covers y≈4000–6000`) so fixes can be located in source.
4. The full-page PNG is always kept beside crops (`*-full.png`) — cite it for anything ambiguous.

## Examples

```bash
harness html-snap --file docs/plans/065-deterministic-documents/dd-infographic.html --slices 8
harness html-snap --file page.html --width 500 --page-height 16000 --slices 10     # narrow pass (500 = chrome-headless minimum window width; smaller values are refused — they lay out at 500 and crop, faking clipped content)
harness html-snap --file page.html --offset 3200 --crop-height 1200 --out /tmp/beat2.png
```

## Environment

- `HTML_SNAP_CHROME` — explicit browser binary. If set and missing, the verb **errors rather than falling back** (a forced path that silently falls back is a skip that looks like a pass).
- Otherwise a candidate ladder is probed (macOS Chrome/Chromium/Edge, Linux google-chrome/chromium/microsoft-edge). None found → `unconfigured` naming every probed path.
- Cropping uses `sips` (macOS) or `magick` (Linux ImageMagick); neither present → full-page render still succeeds, `degraded` names the gap.

## Proven failure modes (recorded live proofs, 2026-08-03, this repo)

Run before first trust, per governance: a control that has only seen good input is demonstrated, not tested.

| Known-bad input | Expected | Proof |
|---|---|---|
| `--file /nope.html` | `error HTML_SNAP_FILE_MISSING` | live envelope below |
| `--offset 99000 --crop-height 900` (page 14000) | `error HTML_SNAP_BAD_ARGS` naming the overflow | live envelope below |
| `HTML_SNAP_CHROME=/nonexistent/chrome` | `error HTML_SNAP_CHROME_MISSING`, **no fallback** | live envelope below |
| Unit suite (`snap-core.test.ts`) | ladder, validation, crop argv, empty-render verdicts RED/GREEN | `npx vitest run` (extensions sweep) |

Live proof run (2026-08-03, macOS, worktree s065, harness 0.13.0 root dist):

```
GOOD       → status ok    · 3 slice PNGs · chrome via probe · cropTool sips
BAD-FILE   → status error · HTML_SNAP_FILE_MISSING
BAD-OFFSET → status error · HTML_SNAP_BAD_ARGS (offset 99000 + crop 900 > page 3000… flagged pre-render)
BAD-ENV    → status error · HTML_SNAP_CHROME_MISSING (no fallback despite probes being available)
```
