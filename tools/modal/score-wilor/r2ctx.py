"""Pipeline 2 の R2 アクセスをカプセル化する Ctx。

前処理 (preprocess) と採点 (scoring) の両ステージが共有する。 どちらのステージの実装も
「R2 を stateless に読み書きする純粋な処理」として書ける (= 入力は R2 にあるオブジェクト、
出力も R2 オブジェクト or スコア)。 これにより採点対象データがストレージに在ることが保証され、
前処理と採点が疎結合になる (= 採点だけ後で再実行できる)。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Ctx:
    """1 クリップ分の R2 入出力コンテキスト。 boto3 client は呼び出し側 (Modal 関数) が注入する。"""

    signature_hash: str
    s3: object  # boto3 S3 client
    bucket_raw: str
    bucket_processed: str
    work_dir: str

    def _raw_key(self, name: str) -> str:
        return f"raw/{self.signature_hash}/{name}"

    def _proc_key(self, name: str) -> str:
        return f"processed/{self.signature_hash}/{name}"

    # ─── raw (端末アップロード) ─────────────────────────────────────────
    def download_raw(self, name: str) -> str:
        """raw/<hash>/<name> を work_dir に download し、 ローカルパスを返す。 無ければ例外。"""
        path = f"{self.work_dir}/{name}"
        self.s3.download_file(self.bucket_raw, self._raw_key(name), path)
        return path

    @staticmethod
    def _is_not_found(e: Exception) -> bool:
        """ClientError が 404 / NoSuchKey か (= オブジェクト不在)。 botocore を import せず response を duck-type。"""
        resp = getattr(e, "response", None)
        code = str(resp.get("Error", {}).get("Code", "")) if isinstance(resp, dict) else ""
        return code in ("NoSuchKey", "NoSuchBucket", "404", "NotFound")

    def raw_exists(self, name: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket_raw, Key=self._raw_key(name))
            return True
        except Exception as e:  # noqa: BLE001
            if self._is_not_found(e):
                return False
            raise  # transient / 権限エラーは「不在」と誤認させず伝播

    # ─── processed (前処理 / 採点の出力) ──────────────────────────────
    def read_processed_text(self, name: str) -> str | None:
        """processed/<hash>/<name> を文字列で読む。 不在なら None。
        ⚠ transient な R2 エラーを「不在 (= 前処理未実行)」と誤認しないよう、 404 系のみ None、 他は再 raise。"""
        try:
            obj = self.s3.get_object(Bucket=self.bucket_processed, Key=self._proc_key(name))
            return obj["Body"].read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            if self._is_not_found(e):
                return None
            raise

    def upload_processed(self, local_path: str, name: str, content_type: str) -> str:
        key = self._proc_key(name)
        self.s3.upload_file(local_path, self.bucket_processed, key, ExtraArgs={"ContentType": content_type})
        return key

    def put_processed_text(self, name: str, text: str, content_type: str) -> str:
        key = self._proc_key(name)
        self.s3.put_object(Bucket=self.bucket_processed, Key=key, Body=text.encode("utf-8"), ContentType=content_type)
        return key
