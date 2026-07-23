# RootLens data access

Recordings live in a Cloudflare R2 bucket. One recording per folder: `<id>/session.mcap`.
`manifest.jsonl` at the bucket root lists every recording's attributes (one JSON object
per line) so you can filter without listing folders. New recordings are added over time;
re-run the download later to pick them up — the manifest is kept up to date automatically.

## Access

Needs [rclone](https://rclone.org/install/). The access credentials are sent by DM.

1. Create `~/.config/rclone/rclone.conf` (make the folder if it does not exist) with this
   exact content, pasting in the credentials from the DM:

   ```ini
   [rootlens]
   type = s3
   provider = Cloudflare
   access_key_id = ACCESS_KEY_ID
   secret_access_key = SECRET_ACCESS_KEY
   endpoint = https://4fe04c4663fa99a8ea2f8b6eb80d5e0c.r2.cloudflarestorage.com
   region = auto
   ```

2. Then run:

   ```bash
   rclone lsf  rootlens:rootlens-fpvlabs                              # list recordings
   rclone copy rootlens:rootlens-fpvlabs ./rootlens-data --progress   # download (resumable)
   ```

If you see `didn't find section in config file ("rootlens")`, the config file above
has not been created yet (step 1).

## Manifest fields

Each line of `manifest.jsonl` describes one recording:

| field | meaning |
|---|---|
| `contentHash` | recording id = the folder name |
| `domain` | kind of work filmed: `home` (household chores) / `bakery` (bakery work) |
| `site` | recording location id within the domain (e.g. `bakery-01`) |
| `recordedAt` | recording start time, ISO 8601 UTC (read from the video container) |
| `uploadedAt` | upload completion time, ISO 8601 UTC |
| `durationSec` | recording length in seconds |
| `fps` | RGB frame rate |
| `resolution` | RGB frame size, `WxH` |
| `device`, `osVersion` | capture device |
| `blurred` | faces are blurred (always `true` in this bucket) |
| `mcapBytes` | size of `session.mcap` |

Face-blur details (detector, threshold, pipeline version) are recorded inside each
MCAP on the `/rootlens/processing_info` topic.

Example — list bakery recordings only:

```bash
jq -r 'select(.domain=="bakery") | .contentHash' rootlens-data/manifest.jsonl
```

## Notes

- The MCAP layout matches stera-sdk's MCAPReader topic configuration (same topics,
  schemas, and encodings), so `stera.data.mcap` reads it directly.
- The recorded workers have consented to filming and to this data use. Incidental
  bystanders are face-blurred before delivery.
