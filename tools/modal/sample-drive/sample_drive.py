# サンプルデータの Google Drive 直送。
#
# rootlens-raw-arkit + rootlens-fpvlabs を読み、 共有ドライブ `RootLens Datasets` の
#   samples/<domain>/<pipeline>/<session-dir>/{rgb.mp4, session.mcap, manifest.json}
# の形に配置する。 R2 → Drive は Modal 内で完結し、 装着端末側の回線を消費しない。
#
# 冪等: 同 session-dir が既に存在すれば中のファイルを上書き。 session-dir 名は
# YYYY-MM-DD_HHMM_<hash8>/ で、 clips.recorded_at (= 録画開始の壁時計 UTC) と
# content_hash から一意に決まる。 domain も DB (accounts) から解決する。
#
# 実行:
#   modal run --detach tools/modal/sample-drive/sample_drive.py --content-hash <hash>
#
# 権限: サービスアカウント datasets-writer@rootlens-503301.iam.gserviceaccount.com が
#   共有ドライブに「コンテンツ管理者」で招待されている前提。 招待が漏れると 404 になる。

from __future__ import annotations

import datetime as dt
import io
import json
import os
import subprocess
import tempfile

# ドライブ用 rgb.mp4 の再エンコード設定。 LP のショーケース (showcase.py) と揃える。
SAMPLE_RGB_BITRATE_KBPS = 5000

try:
    import modal

    # このドライブは公開想定なので、 サンプル rgb.mp4 は必ず顔ぼかし済みでないといけない。
    # 本筋の工程 (fpvlabs.py) はそのままで、 このアップローダの中だけで MCAP のぼかし済み JPEG
    # 列を取り出して mp4 に再エンコードする経路を敷く。 EgoBlur の再実行はしない
    # (= 納品物と完全に同じぼかしを保証、 GPU / 計算コストゼロ)。 ffmpeg + mcap ライブラリだけ要る。
    image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("ffmpeg")
        .pip_install(
            "boto3",
            "psycopg2-binary",  # clips / accounts 照合 (時刻とドメインの解決) 用
            "google-api-python-client",
            "google-auth",
            "mcap",
            "mcap-ros2-support",
        )
    )

    app = modal.App("rootlens-sample-drive")

    @app.function(
        image=image,
        timeout=3600,
        memory=4096,
        cpu=2.0,
        secrets=[
            modal.Secret.from_name("r2-creds"),
            modal.Secret.from_name("google-drive"),
            modal.Secret.from_name("supabase-db"),  # DATABASE_URL (clips / accounts 照合用)
        ],
    )
    def upload_one(content_hash: str) -> dict:
        return _upload_session(content_hash)

    @app.local_entrypoint()
    def main(content_hash: str):
        """--content-hash <hash> (domain は DB の accounts から解決)"""
        print(json.dumps(upload_one.remote(content_hash), indent=2))

except ImportError:
    modal = None


# ══════════════════════════════════════════════════════════════════════
# Drive クライアント (サービスアカウント + shared drive)
# ══════════════════════════════════════════════════════════════════════

def _drive_client():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds_json = os.environ["GOOGLE_DRIVE_CREDENTIALS_JSON"]
    info = json.loads(creds_json)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/drive"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _shared_drive_id() -> str:
    return os.environ["GOOGLE_DRIVE_SHARED_ID"]


def _find_or_create_folder(drive, name: str, parent_id: str) -> str:
    """parent_id 下に name フォルダを (無ければ作って) 返す。 同名重複は最初のものを採用。
    共有ドライブ配下なので supportsAllDrives / includeItemsFromAllDrives を明示。"""
    # 検索: name 一致 + フォルダ + parent 一致 + 未削除。
    safe = name.replace("'", "\\'")
    q = f"name='{safe}' and mimeType='application/vnd.google-apps.folder' and '{parent_id}' in parents and trashed=false"
    res = drive.files().list(
        q=q,
        fields="files(id, name)",
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
        corpora="drive",
        driveId=_shared_drive_id(),
    ).execute()
    hits = res.get("files") or []
    if hits:
        return hits[0]["id"]
    created = drive.files().create(
        body={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        },
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return created["id"]


def _upload_file(drive, folder_id: str, name: str, local_path: str, mime: str) -> dict:
    """folder_id 直下に name として local_path を上げる。 既存があれば media 差し替え。"""
    from googleapiclient.http import MediaFileUpload

    safe = name.replace("'", "\\'")
    q = f"name='{safe}' and '{folder_id}' in parents and trashed=false"
    existing = drive.files().list(
        q=q,
        fields="files(id, name, size)",
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
        corpora="drive",
        driveId=_shared_drive_id(),
    ).execute().get("files") or []

    media = MediaFileUpload(local_path, mimetype=mime, resumable=True, chunksize=32 * 1024 * 1024)
    if existing:
        file_id = existing[0]["id"]
        req = drive.files().update(
            fileId=file_id, media_body=media, supportsAllDrives=True, fields="id, name, size",
        )
    else:
        req = drive.files().create(
            body={"name": name, "parents": [folder_id]},
            media_body=media,
            supportsAllDrives=True,
            fields="id, name, size",
        )
    response = None
    while response is None:
        _, response = req.next_chunk()
    return {"id": response["id"], "name": response["name"], "size": int(response.get("size", 0))}


# ══════════════════════════════════════════════════════════════════════
# R2 クライアント
# ══════════════════════════════════════════════════════════════════════

def _r2_client():
    import boto3

    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


# ══════════════════════════════════════════════════════════════════════
# メイン: 1 セッションを R2 から取ってきて Drive に置く
# ══════════════════════════════════════════════════════════════════════

def _blurred_rgb_from_mcap(mcap_path: str, meta: dict, out_mp4: str) -> dict:
    """MCAP の /camera/rgb/compressed (顔ぼかし済み JPEG 列) を H.264 mp4 に再エンコードする。
    ぼかしは fpvlabs 側で適用済みなので再実行しない (= 納品物と完全に同じぼかし結果を保証、
    追加の GPU 計算ゼロ)。 fps は metadata の recording_rate_hz に合わせる (MCAP のタイムスタンプ
    と ±10ms 程度でずれるが、 サンプル再生上は判別不能)。
    ⚠ 装着者以外が映る現場 (パン屋等) では絶対に生 rgb を Drive に出さない。 この関数が唯一の
      Drive 用 rgb 経路。"""
    from mcap.reader import make_reader
    from mcap_ros2.decoder import DecoderFactory

    fps = float((meta.get("capture_settings") or {}).get("recording_rate_hz") or 15)

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "image2pipe", "-vcodec", "mjpeg",
        "-framerate", f"{fps:.6f}",
        "-i", "-",
        "-c:v", "libx264", "-preset", "medium",
        "-b:v", f"{SAMPLE_RGB_BITRATE_KBPS}k",
        "-pix_fmt", "yuv420p",
        "-an",
        "-movflags", "+faststart",
        out_mp4,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None
    frame_count = 0
    try:
        with open(mcap_path, "rb") as fh:
            reader = make_reader(fh, decoder_factories=[DecoderFactory()])
            for _, _, _, ros_msg in reader.iter_decoded_messages(
                    topics=["/camera/rgb/compressed"]):
                proc.stdin.write(ros_msg.data)  # data フィールドが JPEG bytes
                frame_count += 1
    finally:
        proc.stdin.close()
    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"ffmpeg exited {rc} while encoding blurred rgb")
    if frame_count == 0:
        raise RuntimeError("mcap contained no /camera/rgb/compressed frames")
    return {"bytes": os.path.getsize(out_mp4), "frames": frame_count, "fps": fps}


def _clip_row(content_hash: str) -> dict:
    """clips + accounts から現場と時刻を引く (= フォルダ名と manifest の源泉)。
    未登録クリップ / accounts 行なし / recorded_at 未記録はすべて fail-loud
    (recorded_at は fpvlabs.py か gen_manifest.py が rgb.mp4 の mvhd から埋める)。"""
    import psycopg2

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select c.recorded_at, c.created_at, a.domain"
                " from clips c left join accounts a on a.id = c.account_id"
                " where c.content_hash = %s",
                (content_hash,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        raise RuntimeError(f"clip not registered in DB: {content_hash}")
    recorded_at, created_at, domain = row
    if domain is None:
        raise RuntimeError("account has no accounts row (domain/site); insert it first")
    if recorded_at is None:
        raise RuntimeError(
            "clips.recorded_at is null; run fpvlabs (or gen_manifest.py) first so the"
            " folder name can carry the real recording time")
    return {"recorded_at": recorded_at, "created_at": created_at, "domain": domain}


def _session_dirname(content_hash: str, recorded_at: "dt.datetime") -> str:
    """YYYY-MM-DD_HHMM_<hash8>/。 clips.recorded_at (= rgb.mp4 の mvhd 由来の
    録画開始時刻、 UTC) から決める。"""
    return f"{recorded_at.strftime('%Y-%m-%d_%H%M')}_{content_hash[:8]}"


def _upload_session(content_hash: str) -> dict:
    from googleapiclient.errors import HttpError

    # 現場 (domain) と時刻は DB が正。 GPU こそ使わないが、 大きな転送が始まる前に fail-loud。
    clip = _clip_row(content_hash)
    domain = clip["domain"]

    s3 = _r2_client()
    bucket_raw = os.environ.get("R2_BUCKET_RAW_ARKIT", "rootlens-raw-arkit")
    bucket_fpv = os.environ.get("R2_BUCKET_FPVLABS", "rootlens-fpvlabs")

    drive = _drive_client()
    root = _shared_drive_id()
    samples_id = _find_or_create_folder(drive, "samples", root)
    domain_id = _find_or_create_folder(drive, domain, samples_id)
    # arkit は現状唯一のパイプライン。 他が増えたら metadata から拾って分岐する。
    pipeline_id = _find_or_create_folder(drive, "arkit", domain_id)

    with tempfile.TemporaryDirectory() as tmp:
        # ── metadata.json (manifest のカメラ情報に使う) ──
        meta_path = os.path.join(tmp, "metadata.json")
        s3.download_file(bucket_raw, f"raw/{content_hash}/metadata.json", meta_path)
        with open(meta_path) as fh:
            meta = json.load(fh)
        session_name = _session_dirname(content_hash, clip["recorded_at"])
        session_id = _find_or_create_folder(drive, session_name, pipeline_id)

        # ── session.mcap を先に落とす。 rgb.mp4 のぼかし済み映像はここから取り出すので必須。 ──
        mcap_path = os.path.join(tmp, "session.mcap")
        try:
            s3.download_file(bucket_fpv, f"{content_hash}/session.mcap", mcap_path)
        except Exception as e:
            raise RuntimeError(
                f"session.mcap missing for {content_hash[:8]}. "
                f"drive upload requires the blurred JPEG stream from mcap; "
                f"run fpvlabs first: {e}"
            )

        uploaded = []

        # ── rgb.mp4 (ぼかし済み。 MCAP 内の /camera/rgb/compressed から取り出して再エンコード) ──
        rgb_path = os.path.join(tmp, "rgb.mp4")
        rgb_stats = _blurred_rgb_from_mcap(mcap_path, meta, rgb_path)
        uploaded.append(_upload_file(drive, session_id, "rgb.mp4", rgb_path, "video/mp4"))

        # ── session.mcap (fpvlabs パイプラインの成果物 = 納品本体) ──
        uploaded.append(_upload_file(drive, session_id, "session.mcap", mcap_path,
                                     "application/octet-stream"))

        # ── manifest.json (human-readable な要約。 このドライブは公開想定なので、
        #    取引先名や内部インフラの命名を含む項目は入れない: バケット名や appVersion は載せない) ──
        manifest = {
            "contentHash": content_hash,
            "recordingConfig": meta.get("recording_config", "arkit"),
            "device": meta.get("device_model"),
            "os": meta.get("os_version"),
            "camera": meta.get("camera"),
            "captureSettings": meta.get("capture_settings"),
            "recordedAt": clip["recorded_at"].isoformat(),
            "uploadedAt": clip["created_at"].isoformat(),
            "driveFolder": session_name,
        }
        man_path = os.path.join(tmp, "manifest.json")
        with open(man_path, "w") as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
        uploaded.append(_upload_file(drive, session_id, "manifest.json", man_path, "application/json"))

        return {
            "contentHash": content_hash,
            "domain": domain,
            "pipeline": "arkit",
            "sessionFolder": session_name,
            "driveSessionId": session_id,
            "uploaded": uploaded,
        }
