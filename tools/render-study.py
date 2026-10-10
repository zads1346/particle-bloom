"""Offline geometry/shader study. NOT a browser screenshot or hardware benchmark.
Requires numpy, Pillow, scipy and moderngl (5.12.0); EGL software rendering works.
node tools/export-study.mjs /tmp/particle-bloom-study
PYTHONPATH=/tmp/particle-render-tools python tools/render-study.py
"""
from pathlib import Path
import json,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy.ndimage import gaussian_filter
import moderngl
root=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/particle-bloom-study')
output=Path(sys.argv[2] if len(sys.argv)>2 else 'artifacts/offline-shader-study.png')
data=json.loads((root/'study.json').read_text())
ctx=moderngl.create_standalone_context(backend='egl');size=760
vertex='#version 330\nin vec3 position;\nin vec3 color;\nuniform mat4 modelViewMatrix;\nuniform mat4 projectionMatrix;\n'+data['vertexShader'].replace('attribute ','in ').replace('varying ','out ')
fragment='#version 330\nout vec4 fragColor;\n'+data['fragmentShader'].replace('varying ','in ').replace('gl_FragColor','fragColor')
program=ctx.program(vertex_shader=vertex,fragment_shader=fragment)
attributes=[]
for name,key in [('position','position'),('color','color'),('aScatter','scatter'),('aData','data')]:attributes.append((ctx.buffer((root/f'{key}.bin').read_bytes()),'3f',name))
vao=ctx.vertex_array(program,attributes);fbo=ctx.simple_framebuffer((size,size),components=4,dtype='f4');fbo.use()
ctx.enable(moderngl.PROGRAM_POINT_SIZE|moderngl.BLEND);ctx.blend_func=moderngl.SRC_ALPHA,moderngl.ONE
program['projectionMatrix'].write(np.array(data['projection'],dtype='f4').tobytes())
for key,value in {'uTime':8.,'uPixelRatio':1.,'uPointScale':1.55,'uScan':0.,'uMotion':1.}.items():program[key].value=value
sheet=Image.new('RGB',(size*3,(size+70)*2+80),'#091018');draw=ImageDraw.Draw(sheet)
try:font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
except:font=small=ImageFont.load_default()
for n,view in enumerate(data['views']):
 fbo.clear(0,0,0,0);program['modelViewMatrix'].write(np.array(view['modelView'],dtype='f4').tobytes());program['uGather'].value=view['gather'];vao.render(moderngl.POINTS,vertices=data['count'])
 arr=np.frombuffer(fbo.read(components=4,dtype='f4'),dtype='f4').reshape(size,size,4)[::-1,:,:3]
 # A restrained preview glow only. Three.js postprocessing is NOT executed here.
 glow=gaussian_filter(np.maximum(arr-.5,0),sigma=(3,3,0))*.22
 arr=np.clip(arr+glow,0,1)**(1/2.2)
 image=Image.fromarray((arr*255).astype('uint8'));x=n%3*size;y=n//3*(size+70)
 sheet.paste(image,(x,y));draw.text((x+20,y+size+15),view['name'],font=font,fill='#a7b9c2')
draw.text((20,sheet.height-60),'OFFLINE SHADER STUDY · actual particle buffers + adapted GLSL · software EGL / llvmpipe',font=font,fill='#d9b8c5')
draw.text((20,sheet.height-31),'Not a browser screenshot. UI, camera compositing and Three.js postprocessing are not represented.',font=small,fill='#84949f')
output.parent.mkdir(parents=True,exist_ok=True);sheet.save(output)
print(json.dumps({'output':str(output),'renderer':ctx.info['GL_RENDERER'],'shader_compile':'passed','views':len(data['views'])}))
