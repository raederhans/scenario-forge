"""按文件内容派生发布产物的 mtime，让 Pages 的 ETag 只在内容变化时变化。

GitHub Pages 的 ETag 是 ``W/"<mtime 十六进制>-<大小十六进制>"``。CI 每次构建出的文件
mtime 都是构建时刻，于是每次部署后所有 ETag 都会变、回访用户要全量重下。这里把每个文件的
mtime 设为由其 SHA-256 决定的固定时间：内容不变则 mtime 不变，ETag 也不变，条件请求就能
命中 304；内容变了，mtime 跟着变（另有大小参与），ETag 随之变化。
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

# 派生时间落在 2000-01-01 起约 8.5 年的区间内：始终是过去的合法时间，不会出现未来时间。
MTIME_BASE_EPOCH = 946_684_800
MTIME_SPAN_SECONDS = 1 << 28
_CHUNK_BYTES = 1 << 20


def content_mtime(path: Path) -> int:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK_BYTES), b""):
            digest.update(chunk)
    return MTIME_BASE_EPOCH + int.from_bytes(digest.digest()[:8], "big") % MTIME_SPAN_SECONDS


def stamp_tree(root: Path) -> int:
    """把 root 下每个普通文件的 atime/mtime 设为内容派生时间，返回处理的文件数。"""
    if not root.is_dir():
        raise NotADirectoryError(f"not a directory: {root}")
    count = 0
    for directory, _dirnames, filenames in os.walk(root):
        for name in filenames:
            path = Path(directory) / name
            if path.is_symlink() or not path.is_file():
                continue
            stamp = content_mtime(path)
            os.utime(path, (stamp, stamp))
            count += 1
    return count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", type=Path, help="发布产物根目录")
    args = parser.parse_args(argv)
    count = stamp_tree(args.root)
    print(f"stamped content-derived mtime on {count} files under {args.root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
