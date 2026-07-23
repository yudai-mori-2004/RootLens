# サンプルデータの Google Drive 直送。
#
# rootlens-raw-arkit + rootlens-fpvlabs を読み、 共有ドライブ `RootLens Datasets` の
#   samples/<domain>/<pipeline>/<session-dir>/{rgb.mp4, session.mcap, manifest.json}
# の形に配置する。 R2 → Drive は Modal 内で完結し、 装着端末側の回線を消費しない。
#
# 冪等: 同 session-dir が既に存在すれば中のファイルを上書き。 session-dir 名は
# YYYY-MM-DD_HHMM_<hash8>/ で、 recording_started_at と content_hash から一意に決まる。
#
# 実行:
#   modal run tools/modal/drive/upload.py --content-hash <hash> --domain home
#   modal run tools/modal/drive/upload.py --all --domain home     (== account_id ごとに全部)
#
# 権限: サービスアカウント datasets-writer@rootlens-503301.iam.gserviceaccount.com が
#   共有ドライブに「コンテンツ管理者」で招待されている前提。 招待が漏れると 404 になる。

from __future__ import annotations

import datetime as dt
import io
import json
import os
import tempfile

try:
    import modal

    image = (
        modal.Image.debian_slim(python_version="3.11")
        .pip_install(
            "boto3",
            "google-api-python-client",
            "google-auth",
        )
    )

    app = modal.App("rootlens-drive-upload")

    @app.function(
        image=image,
        timeout=3600,
        memory=4096,
        cpu=2.0,
        secrets=[
            modal.Secret.from_name("r2-creds"),
            modal.Secret.from_name("google-drive"),
        ],
    )
    def upload_one(content_hash: str, domain: str) -> dict:
        return _upload_session(content_hash, domain)

    @app.local_entrypoint()
    def main(content_hash: str, domain: str):
        """--content-hash <hash> --domain home|bakery"""
        print(json.dumps(upload_one.remote(content_hash, domain), indent=2))

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

def _session_dirname(content_hash: str, meta: dict) -> str:
    """YYYY-MM-DD_HHMM_<hash8>/。 recording 開始時刻は metadata から拾えないので、
    R2 の rgb.mp4 のオブジェクト作成時刻を代替に使う (= 装着端末が PUT した時刻)。"""
    ts = meta.get("_created_at_iso")
    if ts:
        try:
            t = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            stamp = t.strftime("%Y-%m-%d_%H%M")
        except ValueError:
            stamp = "unknown"
    else:
        stamp = "unknown"
    return f"{stamp}_{content_hash[:8]}"


def _upload_session(content_hash: str, domain: str) -> dict:
    from googleapiclient.errors import HttpError

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
        # ── metadata.json (先に読む: dirname と manifest に使う) ──
        meta_path = os.path.join(tmp, "metadata.json")
        s3.download_file(bucket_raw, f"raw/{content_hash}/metadata.json", meta_path)
        with open(meta_path) as fh:
            meta = json.load(fh)
        # rgb.mp4 の R2 上の Last-Modified を dirname に使う。
        head = s3.head_object(Bucket=bucket_raw, Key=f"raw/{content_hash}/rgb.mp4")
        meta["_created_at_iso"] = head["LastModified"].isoformat()
        session_name = _session_dirname(content_hash, meta)
        session_id = _find_or_create_folder(drive, session_name, pipeline_id)

        uploaded = []

        # ── rgb.mp4 (プレビュー用に生をそのまま) ──
        rgb_path = os.path.join(tmp, "rgb.mp4")
        s3.download_file(bucket_raw, f"raw/{content_hash}/rgb.mp4", rgb_path)
        uploaded.append(_upload_file(drive, session_id, "rgb.mp4", rgb_path, "video/mp4"))

        # ── session.mcap (fpvlabs パイプラインの成果物 = 納品本体) ──
        mcap_path = os.path.join(tmp, "session.mcap")
        try:
            s3.download_file(bucket_fpv, f"{content_hash}/session.mcap", mcap_path)
            uploaded.append(_upload_file(drive, session_id, "session.mcap", mcap_path,
                                         "application/octet-stream"))
        except Exception as e:
            # fpvlabs 未処理のセッションは MCAP なしで rgb だけ置く (= 後で埋める)。
            print(f"[warn] no session.mcap for {content_hash[:8]}: {e}")

        # ── manifest.json (human-readable な要約。 このドライブは公開想定なので、
        #    取引先名や内部インフラの命名を含む項目は入れない: sourceBucket / deliveryBucket /
        #    appVersion は削除、 タイムスタンプ名も R2 由来を伏せた recordedAt に変更) ──
        manifest = {
            "contentHash": content_hash,
            "recordingConfig": meta.get("recording_config", "arkit"),
            "device": meta.get("device_model"),
            "os": meta.get("os_version"),
            "camera": meta.get("camera"),
            "captureSettings": meta.get("capture_settings"),
            "recordedAt": meta["_created_at_iso"],
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
