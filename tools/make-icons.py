#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成插件图标：深蓝底 + 琥珀金圆 + 深蓝「溢」字"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)

BG = (11, 27, 52, 255)      # 深蓝 #0b1b34
AMBER = (245, 182, 74, 255) # 琥珀金 #f5b64a
INK = (11, 27, 52, 255)     # 字色深蓝

SIZES = [16, 48, 128]


def font_for(size):
    """找中文字体"""
    candidates = [
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
        '/Library/Fonts/Arial Unicode.ttf',
        '/System/Library/Fonts/Supplemental/Songti.ttc',
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, int(size * 0.62), index=0)
            except Exception:
                continue
    return ImageFont.load_default()


def make(size):
    img = Image.new('RGBA', (size, size), BG)
    d = ImageDraw.Draw(img)
    # 金色圆底
    pad = max(1, int(size * 0.10))
    d.ellipse([pad, pad, size - pad, size - pad], fill=AMBER)
    # 字
    f = font_for(size)
    ch = '溢'
    try:
        bbox = d.textbbox((0, 0), ch, font=f)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), ch, font=f, fill=INK)
    except Exception:
        d.text((size * 0.3, size * 0.25), ch, fill=INK)
    return img


if __name__ == '__main__':
    for s in SIZES:
        make(s).save(os.path.join(OUT, f'icon-{s}.png'))
        print('generated', s)
