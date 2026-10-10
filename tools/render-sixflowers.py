"""Render exported real particle buffers + adapted GLSL using offline EGL.

NOT a browser screenshot, UI check, camera check, or hardware benchmark.
Install tools/requirements-render.txt into an isolated render environment first.
  node tools/export-sixflowers.mjs /tmp/particle-bloom-sixflowers
  python tools/render-sixflowers.py /tmp/particle-bloom-sixflowers artifacts/offline-sixflower-preview.png
"""
from pathlib import Path
import hashlib
import json
import os
import sys

import moderngl
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.sixflower-study')
output = Path(sys.argv[2] if len(sys.argv) > 2 else 'artifacts/offline-sixflower-preview.png')
data = json.loads((root / 'study.json').read_text(encoding='utf-8'))
ctx = moderngl.create_standalone_context(backend='egl')
renderer_name = ctx.info['GL_RENDERER']
render_label = 'EGL 软件渲染' if any(name in renderer_name.lower() for name in ['llvmpipe', 'softpipe', 'software']) else 'EGL 离屏渲染'
size = 530
vertex = ('#version 330\nin vec3 position;\nin vec3 color;\nuniform mat4 modelViewMatrix;\nuniform mat4 projectionMatrix;\n'
          + data['vertexShader'].replace('attribute ', 'in ').replace('varying ', 'out '))
fragment = ('#version 330\nout vec4 fragColor;\n'
            + data['fragmentShader'].replace('varying ', 'in ').replace('gl_FragColor', 'fragColor'))
program = ctx.program(vertex_shader=vertex, fragment_shader=fragment)
fbo = ctx.simple_framebuffer((size, size), components=4, dtype='f4')
fbo.use()
ctx.enable(moderngl.PROGRAM_POINT_SIZE | moderngl.BLEND)
ctx.blend_func = moderngl.SRC_ALPHA, moderngl.ONE
program['projectionMatrix'].write(np.array(data['projection'], dtype='f4').tobytes())
for key, value in {'uTime': 8., 'uPixelRatio': 1., 'uPointScale': 1.55, 'uScan': 0., 'uMotion': 0., 'uGather': 1.}.items():
    if key in program:
        program[key].value = value

font_candidates = [os.environ.get('PARTICLE_PREVIEW_FONT', ''), 'C:/Windows/Fonts/msyh.ttc', '/mnt/c/Windows/Fonts/msyh.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']
font_path = next((name for name in font_candidates if name and Path(name).is_file()), None)
if not font_path:
    raise RuntimeError('A Chinese font is required; set PARTICLE_PREVIEW_FONT to a local Chinese font path.')
title_font = ImageFont.truetype(font_path, 47)
label_font = ImageFont.truetype(font_path, 38)
body_font = ImageFont.truetype(font_path, 26)
small_font = ImageFont.truetype(font_path, 23)

tile_width, tile_height, header, footer = 1080, 780, 130, 130
sheet = Image.new('RGB', (tile_width * 3, header + tile_height * 2 + footer), '#071019')
draw = ImageDraw.Draw(sheet)
draw.text((35, 22), data['title'], font=title_font, fill='#f0e4eb')
draw.text((37, 86), f"实际生成器数组 · 每种 {data['countPerFlower']:,} 粒子 · 相同透视与比例", font=body_font, fill='#a6b9c9')
descriptions = {
    'peony': '粉白卷瓣 · 饱满叠层',
    'rose': '酒红螺旋花心 · 外翻花瓣',
    'lotus': '粉色尖瓣 · 金色莲蓬 · 宽绿叶',
    'sunflower': '细长金瓣 · 深棕花盘 · 螺旋种子',
    'tulip': '紫粉六瓣杯状 · 修长茎叶',
    'lily': '白粉反卷花瓣 · 长蕊与金色花粉',
}
render_checks = []
for number, flower in enumerate(data['flowers']):
    x = number % 3 * tile_width
    y = header + number // 3 * tile_height
    draw.rounded_rectangle((x + 9, y + 8, x + tile_width - 9, y + tile_height - 10), radius=20, fill='#0b1520', outline='#21313f', width=2)
    draw.text((x + 28, y + 25), flower['label'], font=label_font, fill='#f0e4eb')
    draw.text((x + 180, y + 38), flower['id'].upper(), font=small_font, fill='#6f8b9c')
    buffers = []
    vao = None
    try:
        attributes = []
        for name, key in [('position', 'position'), ('color', 'color'), ('aScatter', 'scatter'), ('aData', 'data')]:
            binary = (root / flower['id'] / f'{key}.bin').read_bytes()
            if hashlib.sha256(binary).hexdigest() != flower['stats']['buffers'][key]['sha256']:
                raise RuntimeError(f"Exported buffer hash mismatch: {flower['id']}/{key}")
            buffer = ctx.buffer(binary)
            buffers.append(buffer)
            attributes.append((buffer, '3f', name))
        vao = ctx.vertex_array(program, attributes)
        for view_number, view in enumerate(data['views']):
            fbo.clear(0, 0, 0, 0)
            program['modelViewMatrix'].write(np.array(view['modelView'], dtype='f4').tobytes())
            vao.render(moderngl.POINTS, vertices=flower['stats']['count'])
            array = np.frombuffer(fbo.read(components=4, dtype='f4'), dtype='f4').reshape(size, size, 4)[::-1, :, :3]
            # The same restrained whole-frame preview glow and display gamma
            # are applied to every panel. Three.js postprocessing is not run.
            glow = gaussian_filter(np.maximum(array - .5, 0), sigma=(3, 3, 0)) * .22
            rgb = np.clip(array + glow, 0, 1) ** (1 / 2.2)
            background = np.array([7, 16, 25], dtype='f4') / 255
            rgb = np.maximum(rgb, background)
            image = Image.fromarray((rgb * 255).astype('uint8'))
            panel_x = x + 10 + view_number * size
            panel_y = y + 125
            sheet.paste(image, (panel_x, panel_y))
            draw.text((panel_x + 20, y + 89), view['label'], font=small_font, fill='#adbfcc')
            active = np.max(array, axis=2) > .025
            edge = np.concatenate([active[0, :], active[-1, :], active[:, 0], active[:, -1]])
            render_checks.append({'flower': flower['id'], 'view': view['id'], 'finiteFramebuffer': bool(np.isfinite(array).all()), 'nonemptyPixels': int(active.sum()), 'activeBorderPixels': int(edge.sum())})
        draw.text((x + 28, y + 682), descriptions.get(flower['id'], flower.get('description', '')), font=body_font, fill='#c4b3c2')
        draw.text((x + 28, y + 726), f'{render_label} · 聚合状态 · 两视角共用比例', font=small_font, fill='#6f8b9c')
    finally:
        if vao is not None:
            vao.release()
        for buffer in buffers:
            buffer.release()

footer_y = sheet.height - footer
draw.line((28, footer_y + 8, sheet.width - 28, footer_y + 8), fill='#2a3946', width=2)
draw.text((35, footer_y + 25), '离线预览，不是网页运行截图；不包含浏览器界面、摄像头叠加或 Three.js 后处理。', font=body_font, fill='#e7b6c9')
draw.text((35, footer_y + 75), '仅用于比较真实粒子结构与颜色；未验证实机 WebGL、动画、交互或移动端性能。', font=body_font, fill='#8fa3b3')
output.parent.mkdir(parents=True, exist_ok=True)
sheet.save(output)
report = {
    'output': output.name, 'renderer': renderer_name, 'shaderCompile': 'passed',
    'offlineOnly': True, 'image': {'width': sheet.width, 'height': sheet.height, 'mode': sheet.mode, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()},
    'transforms': ['application GLSL qualifier adaptation for OpenGL 3.3', 'uniform gather=1, motion=0', 'same Gaussian preview glow threshold=.5 sigma=3 amplitude=.22', 'same display gamma=1/2.2', 'same camera and scale for every flower/view'],
    'unverified': ['browser UI', 'real WebGL hardware', 'Three.js postprocessing', 'animation and interaction', 'camera', 'mobile device performance'],
    'checks': render_checks,
    'metrics': json.loads((root / 'metrics.json').read_text(encoding='utf-8')),
}
manifest_path = output.with_suffix('.json')
manifest_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({key: report[key] for key in ['output', 'renderer', 'shaderCompile', 'image', 'offlineOnly']}, ensure_ascii=False))
fbo.release()
program.release()
ctx.release()
