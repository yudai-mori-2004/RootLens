# RootLens ASG fork

The RootLens capture APK does not open Mentra Live's UART or I2S route. Those peripherals remain
owned by Mentra's `asg_client`. This patch adds two narrow, signature-scoped IPC boundaries: the
camera-button normal press (`cs_pho`, called short press by the protocol) is delivered to RootLens,
and RootLens sends semantic audio feedback back to ASG.

## Pinned upstream

- Repository: `https://github.com/Mentra-Community/MentraOS`
- Commit: `9684b3d6b27c789cccc429ccc7d34b7f5526aab9`
- Release: official `asg-client` v39
- Device stock APK SHA-256 verified during development:
  `9e26dc820864691bc93c2a15d43d41b26342f01aafc4c8a58b530b0b71e739d7`

The fork is installed as `com.mentra.asg_client.thirdparty`; the signed stock system package stays
on the device and can be re-enabled.

## What the patch changes

1. I2S state is treated as unknown after process/UART startup, then reconciled to stopped.
2. Touch reporting is idempotently enabled after service startup, UART reconnect, I2S stop, and
   before ASG shutdown. The first MCU packet after a case/idle boundary and every BES battery-state
   packet also reassert touch reporting, covering a BES-side reset without an Android UART reconnect.
   Failed UART sends retry with one superseding generation.
3. The camera-button normal press (`cs_pho`, called short press by the protocol) is owned by RootLens
   and sent to its explicit manifest receiver. Delivery is protected by a signature permission. The
   handler always returns after this branch: a missing or disabled RootLens app fails closed with the
   failure cue and can never start CameraNeo. Camera-button long press (`cs_vdo`) never reaches
   CameraNeo. A pure button reducer disambiguates an incomplete one-to-four-press sequence as an
   explicit upload command and five valid presses as the hidden RootLens calibration command.
4. RootLens sends an allowlisted event name; ASG owns `MediaPlayer`, I2S commands, and audio assets.
   Arbitrary K900/UART commands and arbitrary asset paths are not exposed.
5. Before each cue, ASG idempotently converges the dedicated notification stream to its maximum
   hardware-audible level. On this dedicated capture device, lower Android indices attenuate the
   I2S output enough to make feedback inaudible.
6. Generic error events remain silent. The ASG allowlist accepts capture start/stop/failure,
   calibration feedback, and the three explicit upload results: started, complete, and unavailable.
7. An accepted RootLens START or STOP immediately plays the stock recording start/stop effect and
   then `rootlens/capture_start.mp3` or `rootlens/capture_stop.mp3` as one controller-owned sequence.
   Successful finalization is silent; only capture failure has a result announcement.
   RootLens waits for the complete start sequence before opening Camera2.
8. The button recognizer is a pure `state × event -> next state + effects` reducer. Its deadline is
   the earlier of eight seconds after the latest accepted long press and 30 seconds after the first.
   Each accepted step plays stock `click_sound.wav`; timeout after steps one through four emits one
   signature-protected upload Intent, while step five cancels that timeout and emits calibration.
   A normal press cancels a live sequence, sub-second duplicate reports are no-ops, and timer
   revisions make stale callbacks harmless. ASG also owns the allowlisted calibration instructions;
   RootLens waits for their measured 11.651-second duration plus margin before opening the camera.

## Reproduce the build

```bash
git clone https://github.com/Mentra-Community/MentraOS.git /private/tmp/MentraOS
git -C /private/tmp/MentraOS checkout 9684b3d6b27c789cccc429ccc7d34b7f5526aab9
git clone --branch working --single-branch \
  https://github.com/Mentra-Community/StreamPackLite.git \
  /private/tmp/MentraOS/asg_client/StreamPackLite

mentra-os/scripts/prepare-asg-fork.sh \
  /private/tmp/MentraOS \
  "$ANDROID_HOME"
```

The preparation script is idempotent for an already-applied patch. It refuses a different upstream
commit or a checkout with tracked changes.

## Device switch and rollback

Mentra's official development flow is the authority:

- `asg_client/scripts/dev-setup.sh` installs the fork, disables (does not delete) stock ASG, and
  selects the fork as HOME.
- `asg_client/scripts/restore-stock.sh` removes the fork, re-enables stock ASG, and restores HOME.

RootLens also keeps stricter wrappers in `scripts/install-asg-fork.sh` and
`scripts/restore-asg-stock.sh`. The install wrapper validates the coexistence package before
disabling stock and automatically restores stock if the fork service does not become healthy. The
restore wrapper keeps the fork installed but disabled for a fast, data-preserving rollback.

Installing or switching ASG changes the device control plane and requires explicit operator
approval. Never run stock and the fork simultaneously because both would contend for the same UART.
