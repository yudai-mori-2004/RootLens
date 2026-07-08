# RootLens data access

Recordings live in a Cloudflare R2 bucket. One recording per folder: `<id>/session.mcap`.
New recordings are added over time; re-run the download later to pick them up.

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

## Notes

- Each `session.mcap` is validated with stera-sdk's format check before handoff.
- Faces are not blurred, and everyone appearing has consented to being filmed.
