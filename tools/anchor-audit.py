#!/usr/bin/env python3
# 反证脚本的锚点体检：不开任何窗口，几秒跑完。
# 它回答两个问题：
#   1) 源码里现在有没有"上一轮被杀掉留下的注入"？（frm 找不到，且 to 找得到）
#   2) 哪些条目的锚点已经搬家或不再唯一？（frm 出现 0 次 = 失配；>1 次 = 只会注到第一处）
# 这正是"改完 core/ 或 web/ 必须全量重跑反证"那条例子的廉价版本：
# 全量跑一次要开 76 个窗口，而 90% 的风险就是锚点失配，这里一次就查完。
import re
import sys
from pathlib import Path

import os
root = Path(os.environ.get('GAME_ROOT') or Path(__file__).resolve().parent.parent)


def parse(script: Path, base: Path):
    entries = []
    for line in script.read_text().splitlines():
        s = line.strip()
        if '|||' not in s or not s.startswith(('"', "'")):
            continue
        # 条目可能是双引号包的，也可能是单引号包的（说明里带双引号时只能用单引号），
        # 只认一种就会漏掉条目——本轮就漏了一条，体检报了 75/76 才发现
        s = s.rstrip(')')
        if s.endswith('"') or s.endswith("'"):
            s = s[:-1]
        s = s[1:] if s[:1] in ('"', "'") else s
        parts = s.split('|||')
        if len(parts) != 4:
            continue
        path, frm, to, why = parts
        # bash 在数组里会吃的转义：\$ \` \\ 与 \n
        frm = frm.replace('\\$', '$').replace('\\`', '`').replace('\\"', '"')
        to = to.replace('\\$', '$').replace('\\`', '`').replace('\\"', '"')
        frm = frm.replace('\\n', '\n')
        to = to.replace('\\n', '\n')
        entries.append((path, frm, to, why))
    return entries


for script, sub in ((root / 'tools/falsify.sh', 'core'), (root / 'tools/falsify-ui.sh', 'web')):
    missing, dup, injected = [], [], []
    ents = parse(script, root / sub)
    for path, frm, to, why in ents:
        # falsify-ui.sh 的条目自带 web/ 前缀，别再接一遍 sub
        f = root / path if path.startswith(('web/', 'core/')) else root / sub / path
        if not f.exists():
            missing.append((path, why, '文件不存在'))
            continue
        src = f.read_text()
        n = src.count(frm)
        if n == 0:
            if to and to != 'Ø' and src.count(to) >= 1:
                injected.append((path, why))
            else:
                missing.append((path, why, '原样找不到（锚点失配）'))
        elif n > 1:
            dup.append((path, n, why))
    print(f'== {script.name}：{len(ents)} 条')
    for x in injected:
        print('  残留注入 ', x[0], '—', x[1])
    for x in missing:
        print('  锚点失配 ', x[0], '—', x[1], f'（{x[2]}）')
    for x in dup:
        print(f'  锚点多处 x{x[1]} ', x[0], '—', x[2])
    if not (injected or missing or dup):
        print('  全部锚点各命中一次，没有残留注入')
