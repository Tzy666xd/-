#!/usr/bin/env python3
"""把 style-*.png 拼成 2×2 对照表并标上风格名。"""
import sys, os, glob
from PIL import Image, ImageDraw
out = sys.argv[1] if len(sys.argv) > 1 else 'shots'
names = ['style-default', 'style-deco', 'style-engraving', 'style-leather']
labels = {'style-default': 'A 维多利亚牌局（当前）', 'style-deco': 'B 装饰艺术 Art Deco',
          'style-engraving': 'C 铜版画雕刻', 'style-leather': 'D 暖调皮革'}
TW, TH = 900, 506
sheet = Image.new('RGB', (TW * 2, (TH + 30) * 2), (16, 12, 8))
d = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    f = os.path.join(out, n + '.png')
    if not os.path.exists(f):
        print('缺', f); continue
    im = Image.open(f).convert('RGB').resize((TW, TH))
    x, y = (i % 2) * TW, (i // 2) * (TH + 30)
    sheet.paste(im, (x, y + 30))
    d.text((x + 10, y + 8), labels[n], fill=(244, 230, 192))
sheet.save(os.path.join(out, 'styles.png'))
print(f'对照表 → {out}/styles.png  {sheet.size[0]}x{sheet.size[1]}')
