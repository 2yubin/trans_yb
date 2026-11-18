#!/bin/sh
# 새 버전을 친구들에게 배포해요.  실행: sh release.sh
# 1) addon/manifest.json 의 version 을 먼저 올려 두세요(예: 0.16.1 -> 0.16.2).
# 2) 이 스크립트가 시험, 설치 파일 만들기, GitHub Release 올리기, updates.json 고치기, 커밋과 push 를 해요.
# 조테로는 updates.json 을 가끔 확인해서 새 버전이 있으면 스스로 업데이트해요.
set -e
cd "$(dirname "$0")"
V=$(node -p 'require("./addon/manifest.json").version')
if gh release view "v$V" >/dev/null 2>&1; then echo "v$V 는 이미 올렸어요. manifest.json 의 version 을 올려 주세요."; exit 1; fi
# GitHub 웹에서 고친 것(README 등)이 있으면 먼저 받아 와요
git pull --rebase origin main
sh build.sh
HASH=$(shasum -a 256 build/trans_yb.xpi | cut -d' ' -f1)
node -e '
const fs = require("fs"); const [v, h] = process.argv.slice(1);
const u = { addons: { "trans_yb@local.plugin": { updates: [{
  version: v,
  update_link: `https://github.com/2yubin/trans_yb/releases/download/v${v}/trans_yb.xpi`,
  update_hash: `sha256:${h}`,
  applications: { zotero: { strict_min_version: "10.0" } },
}] } } };
fs.writeFileSync("updates.json", JSON.stringify(u, null, 2) + "\n");' "$V" "$HASH"
git add -A
git commit -m "v$V 배포" || true
git push origin main
gh release create "v$V" build/trans_yb.xpi --title "trans_yb $V" --notes "설치: 아래 trans_yb.xpi 를 받아 조테로 Tools → Plugins → 톱니바퀴 → Install Plugin From File"
echo "배포했어요: v$V"
