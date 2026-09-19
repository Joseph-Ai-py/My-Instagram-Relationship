"""Validate the Instagram export ZIP structure expected by the web importer."""
from __future__ import annotations

import sys
import zipfile

REQUIRED = {
    "blocked_profiles.json",
    "close_friends.json",
    "custom_lists.json",
    "follow_requests_you've_received.json",
    "followers_1.json",
    "following.json",
    "hide_story_from.json",
    "profiles_you've_favorited.json",
    "recent_follow_requests.json",
    "recently_unfollowed_profiles.json",
    "restricted_profiles.json",
}
TARGET = "connections/followers_and_following/"


def main(path: str) -> int:
    with zipfile.ZipFile(path) as zf:
        names = {name.replace("\\", "/") for name in zf.namelist()}
        found = {name.rsplit("/", 1)[-1] for name in names if TARGET in name and not name.endswith("/")}
    missing = REQUIRED - found
    extra = found - REQUIRED
    print(f"Required: {len(REQUIRED)}")
    print(f"Found:    {len(REQUIRED & found)}")
    if missing:
        print("Missing:")
        for name in sorted(missing):
            print(f"  - {name}")
        return 1
    if extra:
        print("Other JSON files in target folder:")
        for name in sorted(extra):
            print(f"  + {name}")
    print("OK: Instagram relationship export structure is valid.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python verify.py /path/to/instagram-export.zip")
    raise SystemExit(main(sys.argv[1]))
