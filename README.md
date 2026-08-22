# RootLens

Open-source capture infrastructure for turning real human work into multimodal
training data for embodied AI and robotics.

[RootLens](https://rootlens.io) records first-person work with head-mounted
iPhones or smart glasses, preserves video and motion sensors on a shared
timeline, and delivers consented sessions in buyer-ready formats. The current
pilot focuses on commercial environments such as food preparation, packing,
cleaning, assembly, and other hands-on work.

## Capture methods

RootLens currently supports three independent capture profiles:

- **iPhone ARKit** — 1920x1440 RGB, ARKit camera pose, LiDAR depth and
  confidence, Core Motion IMU, feature points, scene mesh, and optional hand
  landmarks.
- **iPhone RGB + IMU** — 1920x1080 ultra-wide RGB with mono audio and raw
  accelerometer/gyroscope samples, without starting ARKit.
- **Mentra Live** — a standalone Android capture stack for 1920x1080 RGB,
  audio, and raw IMU on the glasses, including per-frame synchronization
  evidence and device-side upload.

Recordings are controlled hands-free using gestures, voice commands, physical
iPhone buttons, or the glasses action button, depending on the device.

## Data flow

```text
Capture device
  -> SHA-256 identity over the raw MP4
  -> consent and review
  -> raw session upload to Cloudflare R2
  -> REST registration through rootlens.io
  -> face blur and delivery conversion on Modal
  -> buyer handoff as Stera-compatible MCAP
```

The raw MP4 SHA-256 is the clip identity across device storage, the API,
database rows, R2 keys, and delivery artifacts. Face blur is applied before
external handoff. Production recordings and credentials are not stored in this
repository.

## Repository layout

- [`app/`](app/) — React Native + Expo iPhone app and native Swift capture
  modules. See [`app/README.md`](app/README.md) for the delivered file
  contracts and synchronization details.
- [`mentra-os/`](mentra-os/) — native Android capture and upload stack for
  Mentra Live smart glasses.
- [`web/`](web/) — Next.js 16 website and REST API, deployed at
  [rootlens.io](https://rootlens.io).
- [`tools/modal/fpvlabs/`](tools/modal/fpvlabs/) — GPU face blur and conversion
  from raw sessions to Stera-compatible MCAP for FPV Labs.
- [`tools/modal/sample-drive/`](tools/modal/sample-drive/) — generation of
  privacy-processed public sample packages.
- [`tools/hand-visibility-qc/`](tools/hand-visibility-qc/) — hand-visibility
  quality checks for first-person footage.
- [`document/legal/`](document/legal/) — Japanese legal source documents and
  their English mirrors.
- [`document/v0.1.4/`](document/v0.1.4/) — active implementation tasks and
  operational runbooks. Earlier version directories are retained as history.

## Stack

- **Mobile:** React Native, Expo, Swift, ARKit, AVFoundation, Core Motion
- **Smart glasses:** Android, Camera2, MediaCodec, Android sensor APIs
- **Web/API:** Next.js 16, TypeScript, Supabase Postgres, Drizzle ORM
- **Storage:** Cloudflare R2
- **Processing:** Python, Modal, EgoBlur, Stera SDK / MCAP
- **Deployment:** Vercel, EAS, Modal

## Development

The iPhone capture modules require a physical device:

```bash
cd app
npm install
cd ios && LANG=en_US.UTF-8 pod install && cd ..
npx expo run:ios --device
```

For the Mentra build and field-device setup, follow
[`mentra-os/README.md`](mentra-os/README.md). Environment variable names are
documented in the checked-in `.env.example` files; local values remain ignored.

## Project status

RootLens is in active pilot development. Interfaces, capture contracts, and
operational tooling may change while field data and buyer requirements are
validated. The implementation and the capture-contract README files are the
source of truth.

## License

[MIT](LICENSE)
