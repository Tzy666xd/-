#!/usr/bin/env python3
"""把 shots/*.png 拼成一张对照表，并逐帧算差异。
差异表才是关键断言：play=0..8 若张张相同，说明渲染层根本没在反映结算事件。"""
import sys, os, glob
from PIL import Image, ImageDraw

out_dir = sys.argv[1] if len(sys.argv) > 1 else 'shots'
files = sorted(glob.glob(os.path.join(out_dir, '*.png')))
if not files:
    print('没有图'); sys.exit(1)

TW, TH = 620, 350
COLS = 3
rows = (len(files) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * TW, rows * (TH + 26)), (18, 14, 10))
draw = ImageDraw.Draw(sheet)

prev = None
print(f'{"帧":14} {"尺寸":11} 与上一帧的平均像素差')
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB')
    name = os.path.basename(f)[:-4]
    thumb = im.resize((TW, TH))
    x, y = (i % COLS) * TW, (i // COLS) * (TH + 26)
    sheet.paste(thumb, (x, y + 26))
    draw.text((x + 6, y + 7), name, fill=(240, 226, 190))
    small = im.resize((160, 90))
    if prev is not None:
        d = sum(abs(a - b) for a, b in zip(small.tobytes(), prev.tobytes())) / (160 * 90 * 3)
        print(f'{name:14} {im.size[0]}x{im.size[1]:5} {d:6.2f}')
    else:
        print(f'{name:14} {im.size[0]}x{im.size[1]:5}   ——')
    prev = small

path = os.path.join(out_dir, 'sheet.png')
sheet.save(path)
print(f'\n对照表 → {path}  {sheet.size[0]}x{sheet.size[1]}')
