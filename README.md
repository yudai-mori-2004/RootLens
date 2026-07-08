# RootLens

Egocentric home-chore video for embodied-AI training data.

An iPhone app that records first-person home chores with a rich sensor stack
(ARKit camera, LiDAR depth, IMU, per-frame camera pose), plus the tooling to
turn each recording into the format the buyer wants.

## Demo

[![RootLens 3-minute demo](https://cdn.loom.com/sessions/thumbnails/4cb5a0bf683f41c8ac4103775894613f-with-play.gif)](https://www.loom.com/share/4cb5a0bf683f41c8ac4103775894613f)

▶ **[Watch the 3-minute demo on Loom](https://www.loom.com/share/4cb5a0bf683f41c8ac4103775894613f)**

## What's in this repo

- `app/` — iOS / Android capture app (React Native + Expo). ARKit-based
  recording, IMU + hand-pose logging, previews, upload to R2.
- `web/` — Next.js 16 landing + REST API (`/api/clips`,
  `/api/v1/raw-uploads`, `/api/v1/consents`). Deployed to
  [rootlens.io](https://rootlens.io).
- `tools/modal/fpvlabs/` — Modal worker that converts a raw session in
  `rootlens-raw-arkit` into a Stera-compatible ROS2 MCAP for
  [FPV Labs](https://fpvlabs.ai/stera), with EgoBlur face blur on GPU.
- `tools/modal/score-wilor/` — earlier score + WiLoR hand-pose pipeline
  (kept as legacy reference, not part of the current production flow).
- `tools/fpvlabs-handoff/` — operator runbook + a helper that lists raw
  clips not yet handed off + the README the buyer receives.
- `tools/egoblur_probe.py` — local calibration harness for the EgoBlur
  detector on new footage.
- `document/v0.1.4/` — active spec + task tracking.

## Stack

- **Mobile app** — React Native (Expo), iOS + Android.
- **Capture** — ARKit + LiDAR + CoreMotion IMU, on-device MediaPipe
  hand landmarker for framing guidance.
- **Storage** — Cloudflare R2 (`rootlens-raw-arkit` for raw, `rootlens-fpvlabs`
  for the handoff MCAPs).
- **Server** — Next.js 16 REST API on Vercel, Supabase Postgres via drizzle.
- **Workers** — Modal (Python) for the FPV Labs handoff (EgoBlur GPU + Stera
  MCAP writer).

## License

See [LICENSE](LICENSE).
