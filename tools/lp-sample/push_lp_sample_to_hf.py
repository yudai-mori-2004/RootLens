"""
LP 第一弾サンプル dataset を HuggingFace Hub に push する。

実行前提:
  - build_lp_sample.py が完了している (= web/public/lp/sample/dataset/ が存在)
  - HF_TOKEN が環境変数か HuggingFace CLI のログインで設定されている

使い方:
  python server/scripts/push_lp_sample_to_hf.py --repo-id <owner>/<dataset-name>

例:
  python server/scripts/push_lp_sample_to_hf.py --repo-id rootlens/lp-sample-v0.1

冪等性: 同じ repo-id で 2 回目実行すると差分のあるファイルだけ upload される (= huggingface_hub の挙動)。
"""

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASET_DIR = REPO_ROOT / "web" / "public" / "lp" / "sample" / "dataset"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-id", required=True, help="HuggingFace dataset repo id (= <owner>/<name>)")
    parser.add_argument("--private", action="store_true", help="private repo として作成")
    parser.add_argument("--token", default=os.environ.get("HF_TOKEN"),
                        help="HuggingFace API token (= 未指定なら $HF_TOKEN を見る)")
    args = parser.parse_args()

    if not DATASET_DIR.exists():
        sys.exit(f"dataset not found: {DATASET_DIR}. build_lp_sample.py を先に走らせてください。")

    if not args.token:
        sys.exit("HF_TOKEN が未設定。 --token か $HF_TOKEN を渡してください。")

    from huggingface_hub import HfApi

    api = HfApi(token=args.token)

    # repo が存在しなければ作る
    api.create_repo(
        repo_id=args.repo_id,
        repo_type="dataset",
        private=args.private,
        exist_ok=True,
    )

    print(f"uploading {DATASET_DIR} → {args.repo_id} ...")
    api.upload_folder(
        folder_path=str(DATASET_DIR),
        repo_id=args.repo_id,
        repo_type="dataset",
        commit_message="Initial upload of RootLens LP sample v0.1",
    )
    print(f"\ndone. https://huggingface.co/datasets/{args.repo_id}")


if __name__ == "__main__":
    main()
