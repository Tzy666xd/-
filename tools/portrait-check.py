#!/usr/bin/env python3
"""肖像可辨性量具。

把每位客人单独渲染成一帧，然后量两两之间肖像区的灰度均差（0-255）。

为什么需要它：零件"写得不同"不等于"看得出不同"。46px 的椭圆里，
帽子与肩线画小了就会全部塌成同一张脸——实测第一版中位差只有 8/255、
496 对里有 223 对低于 8。这条只能量出来，盯着一张图看不出来。

几何从页面里取（--uitest 回传第一位客人 cameo 的包围盒），不写死坐标：
换窗口尺寸或改布局时量具会跟着走，而不是悄悄量到空白处还报告"全一样"。

用法：
    python3 tools/portrait-check.py [--min 12] [--verbose]
退出码 0 表示所有两两差异都不低于 --min。
"""
import itertools
import subprocess
import sys
import os

from PIL import Image, ImageChops

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(GAME, 'dist/几尼.app/Contents/MacOS/Guinea')
WINDOW = '1500x900'
GET_BOX = """(function () {
  var c = document.querySelector('.patron .cameo');
  if (!c) return 'NOCAMEO';
  var b = c.getBoundingClientRect();
  return JSON.stringify({x: b.left, y: b.top, w: b.width, h: b.height, d: devicePixelRatio});
})();"""


def patron_ids():
    out = subprocess.run(['node', '-e',
                          'const{PATRONS}=await import("./core/content.ts");'
                          'console.log(PATRONS.map(p=>p.id).join("\\n"))'],
                         cwd=GAME, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit('读客人名录失败：' + out.stderr[:200])
    return [x for x in out.stdout.split() if x]


def run_headless(query, shot=None, js=None):
    cmd = [BIN, '--boot', 'localStorage.clear()', '--query', query,
           '--delay', '700', '--window', WINDOW]
    if shot:
        cmd += ['--shot', shot]
    if js:
        cmd = [BIN, '--uitest', js, '--boot', 'localStorage.clear()', '--query', query,
               '--uitest-timeout', '15', '--delay', '400', '--window', WINDOW]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip()


def cameo_box():
    import json
    tmp = '/tmp/_portrait_box.js'
    with open(tmp, 'w') as f:
        f.write(GET_BOX)
    raw = run_headless(f'snap=1&autostart=1&seed=4242&seats={patron_ids()[0]}', js=tmp)
    try:
        g = json.loads(raw)
    except Exception:
        sys.exit(f'取不到 cameo 几何，页面回：{raw[:120]}')
    d = g['d']
    return (int(g['x'] * d), int(g['y'] * d), int((g['x'] + g['w']) * d), int((g['y'] + g['h']) * d))


def main():
    min_sep = 12.0
    verbose = '--verbose' in sys.argv
    if '--min' in sys.argv:
        min_sep = float(sys.argv[sys.argv.index('--min') + 1])
    ids = patron_ids()
    box = cameo_box()
    print(f'客人 {len(ids)} 位，肖像区像素框 {box}')
    crops = {}
    for pid in ids:
        path = f'/tmp/_pf-{pid}.png'
        run_headless(f'snap=1&autostart=1&seed=4242&seats={pid}', shot=path)
        if not os.path.exists(path):
            sys.exit(f'{pid} 没出图')
        crops[pid] = Image.open(path).convert('RGB').crop(box)
    # 自检量具本身：任何一张若是纯色，说明框取错了位置，结论一律不可信
    for pid, im in crops.items():
        px = list(im.getdata())
        if all(p == px[0] for p in px):
            sys.exit(f'量具失效：{pid} 的肖像区是纯色，框一定取到了空白处')
    D = {}
    for a, b in itertools.combinations(ids, 2):
        diff = ImageChops.difference(crops[a], crops[b]).convert('L')
        D[(a, b)] = sum(diff.getdata()) / (diff.size[0] * diff.size[1])
    vals = sorted(D.values())
    worst = sorted(D.items(), key=lambda x: x[1])
    print(f'两两差异：中位 {vals[len(vals)//2]:.1f}  最差 {vals[0]:.1f}  '
          f'低于 {min_sep} 的有 {sum(1 for v in vals if v < min_sep)}/{len(vals)} 对')
    if verbose or vals[0] < min_sep:
        for (a, b), v in worst[:12]:
            print(f'  {v:5.1f}  {a} ↔ {b}')
    bad = [(k, v) for k, v in worst if v < min_sep]
    if bad:
        print(f'PORTRAIT FAIL：{len(bad)} 对过于相似（门槛 {min_sep}）')
        return 1
    print('PORTRAIT OK：所有肖像彼此可辨')
    return 0


if __name__ == '__main__':
    sys.exit(main())
