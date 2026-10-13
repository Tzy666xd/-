#!/usr/bin/env python3
"""肖像对照表：把 32 位客人的剪影一次拍成一张图，供肉眼判断＋量两两差异。

为什么需要它：portrait-check 只给"像素差"这一个数，但"分得开"和"好看"是两件事。
美术类判断必须能一次看到全部，否则改一处好没好看不自知。

用法：
    python3 tools/portrait-sheet.py [out.png]
"""
import os
import subprocess
import sys

from PIL import Image, ImageDraw

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(GAME, 'dist/几尼.app/Contents/MacOS/Guinea')

BOOT = r"""
(function () {
  var ids = __IDS__;
  var meta = __META__;
  function fail(e) {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;background:#a00;color:#fff;font:12px monospace;padding:6px';
    d.textContent = 'PFAIL ' + e;
    (document.body || document.documentElement).append(d);
  }
  // user script 里没有文档 base URL，相对 import 会解析到 about:blank —— 自己拼绝对地址
  var url = location.href.slice(0, location.href.indexOf('/index.html')) + '/gen/core/portrait.js';
  window.addEventListener('DOMContentLoaded', function () {
    import(url).then(function (M) {
      var box = document.createElement('div');
      box.id = 'pf-sheet';
      box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;'
        + 'display:grid;grid-template-columns:repeat(4,116px);gap:6px;'
        + 'background:#120d08;padding:8px;border:1px solid #6b5433;';
      var css = document.createElement('style');
      css.textContent = '#pf-sheet .c{width:116px}#pf-sheet .o{position:relative;width:112px;'
        + 'height:54px;border-radius:50%/42%;overflow:hidden;display:block}'
        + '#pf-sheet .o svg{width:100%;height:100%;display:block}'
        + '#pf-sheet .n{font:9px/1.2 Georgia,serif;color:#dcc9a6;text-align:center}';
      document.head.append(css);
      for (var i = 0; i < ids.length; i++) {
        var c = document.createElement('div');
        c.className = 'c';
        var o = document.createElement('span');
        o.className = 'o';
        o.style.background = M.portraitGround(meta[i].t, ids[i]);
        o.innerHTML = M.portraitSvg(ids[i], meta[i].r);
        var n = document.createElement('span');
        n.className = 'n';
        n.textContent = ids[i] + ' ' + meta[i].r[0] + meta[i].t[0];
        c.append(o, n);
        box.append(c);
      }
      document.body.append(box);
    }, fail);
  });
})();
"""


def patrons():
    out = subprocess.run(['node', '-e',
                          'const{PATRONS}=await import("./core/content.ts");'
                          'console.log(JSON.stringify(PATRONS.map(p=>[p.id,p.temperament,p.rarity])))'],
                         cwd=GAME, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit('读客人名录失败：' + out.stderr[:200])
    import json
    return json.loads(out.stdout)


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/portrait-sheet.png'
    rows = patrons()
    ids = [r[0] for r in rows]
    meta = [{'t': r[1], 'r': r[2]} for r in rows]
    js = BOOT.replace('__IDS__', str(ids).replace("'", '"')).replace(
        '__META__', repr(meta).replace("'", '"'))
    # --boot 收的是 JS 源码本身（documentStart 注入），不是文件路径
    subprocess.run([BIN, '--shot', out_path, '--window', '760x1060',
                    '--delay', '1400', '--boot', 'localStorage.clear();' + js],
                   capture_output=True, text=True)
    if not os.path.exists(out_path):
        sys.exit('没出图')
    im = Image.open(out_path).convert('RGB')
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 759, 1059], outline=(255, 0, 255))
    im.save(out_path)
    print(f'对照表 → {out_path}  {im.size[0]}x{im.size[1]}  客人 {len(ids)} 位')
    return 0


if __name__ == '__main__':
    sys.exit(main())
