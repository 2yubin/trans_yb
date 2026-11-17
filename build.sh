#!/bin/sh
# 플러그인 설치 파일(.xpi)을 만들어요.  실행: sh build.sh
set -e
cd "$(dirname "$0")"
node --check addon/content/trans_yb.js
node --check addon/bootstrap.js
node test/core.test.js
node test/layout.test.js
mkdir -p build
rm -f build/trans_yb.xpi
cd addon && zip -qr ../build/trans_yb.xpi . -x '.*' && cd ..
echo "만들었어요: $(pwd)/build/trans_yb.xpi"
