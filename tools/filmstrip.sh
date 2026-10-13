#!/bin/bash
# 把一次动画拆成胶片：**一次启动、按绝对时刻连拍多帧**。
# 分多次启动各拍一张是不行的：进程启动与导航的耗时会把相位打散，
# 采出来的"胶片"根本不是同一条时间轴上的点（实测八帧全落在标题幕淡出上）。
# 用法：bash tools/filmstrip.sh <输出前缀.png> <标注> "<query>" "<触发 JS>" <ms1> <ms2> …
#   输出前缀要含 %d，会被换成各帧的毫秒。
set -uo pipefail
cd "$(dirname "$0")/.."

PREFIX="${1:-/tmp/film-%d.png}"; LABEL="${2:-film}"; QUERY="${3:-}"; TRIG="${4:-}"; shift 4 || true
[[ $# -gt 0 ]] || { echo "至少要一个采样毫秒"; exit 2; }
BIN="dist/几尼.app/Contents/MacOS/Guinea"
W="${FILM_WINDOW:-1200x760}"
DIR=$(dirname "$PREFIX")
BASE=$(basename "$PREFIX")
export NODE_NO_WARNINGS=1
node tools/build-web.mjs --quiet >/dev/null 2>&1 || true

OFFS=$(IFS=,; echo "$*")
"$BIN" --shot "$DIR/$BASE" --window "$W" --delay "${FILM_PRE:-1400}" \
  ${TRIG:+--anim "$TRIG"} --burst "$OFFS" \
  --boot 'try{localStorage.clear()}catch(e){}' --query "$QUERY" >/tmp/burst.out 2>/tmp/film.err
grep -iE "error|失败" /tmp/film.err | head -3
# 连拍会漂：takeSnapshot 一次要 100~150ms，所以标注用**实际抓取时刻**，不用计划时刻
python3 - "$PREFIX" "$LABEL" "$DIR" "$BASE" "$@" <<'PY'
import sys, os, re
from PIL import Image, ImageDraw
prefix, label, d, base = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
ms = sys.argv[5:]
actual = {}
for line in open('/tmp/burst.out', encoding='utf-8'):
    m = re.match(r'^(\d+)\t(\d+)\t(\d+)$', line.strip())
    if m: actual[m.group(1)] = int(m.group(2))
cols = int(os.environ.get('FILM_COLS', '2'))
TW, TH = int(os.environ.get('FILM_TW', '900')), int(os.environ.get('FILM_TH', '470'))
PAD = 24
TOP = float(os.environ.get('FILM_TOP', '0.40'))   # 裁到哪一段：牌桌动作在呢面中上部，别裁掉
ims = []
for m in ms:
    p = os.path.join(d, base.replace('%d', str(m)))
    if not os.path.exists(p):
        print('缺帧', p); continue
    src = Image.open(p).convert('RGB')
    src = src.crop((0, int(src.height * TOP), src.width, src.height))
    im = src.resize((TW, int(src.height * TW / src.width)))
    if im.height > TH: im = im.crop((0, 0, TW, TH))
    ims.append((m, im))
rows = (len(ims) + cols - 1) // cols
out = prefix.replace('%d', 'strip')
sheet = Image.new('RGB', (cols * TW, rows * (TH + PAD)), (14, 11, 7))
dr = ImageDraw.Draw(sheet)
for i, (m, im) in enumerate(ims):
    x, y = (i % cols) * TW, (i // cols) * (TH + PAD)
    sheet.paste(im, (x, y + PAD))
    a = actual.get(str(m))
    dr.text((x + 8, y + 6), f'{label}  t=+{a if a is not None else m}ms', fill=(244, 230, 192))
sheet.save(out)
print(f'胶片 → {out}  {sheet.width}x{sheet.height}  {len(ims)} 帧  实际时刻 {sorted(actual.values())}')
PY
