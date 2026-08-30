# Claru delivery queue

## Upload to Drive

- None. The user reported all delivery batches uploaded on 2026-08-25.

Only directories listed in this section and whose name contains `DELIVERY` are upload candidates.

## Five-hour progress

- Target selected duration: `05:00:00.000`
- Completed and uploaded: `05:53:51.669` (`21,231.669 s`)
- Validated and pending Drive upload: `00:00:00.000` (`0.000 s`)
- Cumulative selected task intervals: `05:53:51.669` (`21,231.669 s`)
- Target surplus: `00:53:51.669` (`3,231.669 s`)
- Actual MP4 duration including keyframe pre-roll through the pending batches: `05:54:33.428`
- Latest completed source: `rec-1787528213668` (`01:29:26.947`), 6 clips exported and validated
- Excluded by review: `rec-1787273189413` (`00:40:30.380`), zero selected intervals and no delivery export
- Excluded by review: `rec-1787278079982` (`00:44:02.302`), zero selected intervals and no delivery export
- Latest source: `rec-1787528213668`
  - Working copy imported from the iPhone on 2026-08-25.
  - MP4 duration: `01:29:26.947`; metadata duration: `01:29:26.732`.
  - Source counts match metadata: 160,992 frames and 539,705 samples for each IMU sensor.
  - Independent three-window RGB-IMU clock audit: `quality: good`; maximum affine-fit residual `4.030 ms`.
  - Six selected intervals exported and independently validated.
- Not required for the five-hour target and still on the iPhone:
  - `rec-1787537283345` (`01:31:59.775`)

## Uploaded; local cleanup pending explicit approval

- `/Users/forest/Downloads/RootLens-Claru-DELIVERY-20260825-173702`
  - Recording `rec-1787267373237`, 9 clips, PASS 9 / REVIEW 0 / FAIL 0.
- `/Users/forest/Downloads/RootLens-Claru-DELIVERY-20260825-182651`
  - Recording `rec-1787528213668`, 6 clips, PASS 6 / REVIEW 0 / FAIL 0.
- Corresponding local source working copies:
  - `rec-1787263927087`
  - `rec-1787267373237`
  - `rec-1787528213668`
- Combined local size: approximately 35.2 GB.
- No local file was removed when upload completion was reported; permanent deletion requires explicit approval.

## Uploaded and removed locally

- Recording 1, 19 clips
  - Drive upload reported complete.
  - Local delivery and superseded export removed on 2026-08-25.
  - Local long source `rec-1787515949653` removed with explicit approval; it remains available on the iPhone.
- Recording 2 (`rec-1787534086150`), 2 clips
  - Drive upload reported complete.
  - Independently validated: PASS 2 / REVIEW 0 / FAIL 0.
  - Local delivery removed on 2026-08-25.
  - Local long source removed with explicit approval; it remains available on the iPhone.
- Recording 3 (`rec-1787263927087`), 4 clips
  - Drive upload reported complete.
  - Independently validated: PASS 4 / REVIEW 0 / FAIL 0.
  - Local delivery removed on 2026-08-25.
- Excluded recordings `rec-1787273189413` and `rec-1787278079982`
  - Zero selected intervals and no delivery export.
  - Local working copies removed on 2026-08-25; originals remain available on the iPhone.

## Do not upload

- `/Users/forest/Downloads/RootLens-Claru-RF-Source`
  - Working copies of long source recordings. Never upload these as delivery.
  - Delete a working copy only after its Drive delivery is confirmed and the user explicitly approves deletion.
- `tools/claru-session-cutter/boundaries/`
  - Internal boundary checkpoints required to reproduce exports.
- `tmp/claru-clock-audits/`
  - Internal clock-model audit inputs required to reproduce exports.
- `document/v0.1.4/tasks/18-claru-session-cutter/validation/`
  - Internal validation reports.

## Storage rule

After a Drive upload is verified, delete its superseded exports first. Delete the
corresponding long source only after the uploaded delivery is confirmed readable.
Never delete boundary checkpoints, clock audits, or validation reports; their
combined size is negligible and they are required for reproducibility.
