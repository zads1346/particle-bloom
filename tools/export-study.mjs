// Exports the real point buffers/shaders for an offline EGL geometry study.
import {mkdirSync,writeFileSync} from 'node:fs';
import {createFlower} from '../src/flower.js';
import {vertexShader,fragmentShader} from '../src/shaders.js';
import {Matrix4,Euler,PerspectiveCamera} from 'three';
const output=process.argv[2]||'/tmp/particle-bloom-study';mkdirSync(output,{recursive:true});
const flower=createFlower(100000);for(const [name,array] of Object.entries(flower))if(array instanceof Float32Array)writeFileSync(`${output}/${name}.bin`,Buffer.from(array.buffer));
const camera=new PerspectiveCamera(39,1,0.1,80);camera.position.set(0,0,8.2);camera.updateMatrixWorld();
const views=[{name:'Front / gathered',angle:0,gather:1},{name:'Oblique 30°',angle:Math.PI/6,gather:1},{name:'Side 60°',angle:Math.PI/3,gather:1},{name:'Half gathered',angle:Math.PI/6,gather:.5},{name:'Star dispersal',angle:0,gather:0},{name:'Petal depth / reverse',angle:Math.PI*.8,gather:1}];
for(const view of views){const model=new Matrix4().makeRotationFromEuler(new Euler(-.15,view.angle,-.13));view.modelView=new Matrix4().multiplyMatrices(camera.matrixWorldInverse,model).toArray();}
writeFileSync(`${output}/study.json`,JSON.stringify({vertexShader,fragmentShader,count:flower.count,projection:camera.projectionMatrix.toArray(),views}));console.log(output);
