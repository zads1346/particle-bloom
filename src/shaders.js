export const vertexShader = `
attribute vec3 aScatter;
attribute vec3 aData;
uniform float uTime;
uniform float uGather;
uniform float uPixelRatio;
uniform float uPointScale;
uniform float uScan;
uniform float uMotion;
varying vec3 vColor;
varying float vAlpha;
varying float vTwinkle;
void main(){
 float seed=aData.x;
 float gather=smoothstep(seed*.20, .78+seed*.22,uGather);
 vec3 dest=position;
 float breathing=sin(uTime*.72+length(position.xy)*1.8)*.018*uMotion;
 dest.xy*=1.+breathing;
 dest.z+=sin(uTime*.6+position.x*2.+position.y*1.4)*.024*uMotion;
 vec3 loose=aScatter;
 float angle=uTime*.075*uMotion+(1.-gather)*1.2;
 mat2 rot=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
 loose.xy=rot*loose.xy;
 loose+=vec3(sin(uTime*.24+seed*66.),cos(uTime*.2+seed*32.),sin(uTime*.25+seed*43.))*.20*uMotion;
 vec3 p=mix(loose,dest,gather);
 p.z+=sin(seed*30.+uTime*.6)*(1.-gather)*.16*uMotion;
 vec4 mvPosition=modelViewMatrix*vec4(p,1.);
 gl_Position=projectionMatrix*mvPosition;
 float twinkle=.80+.20*sin(uTime*uMotion*(.8+seed*1.7)+seed*132.);
 float scan=smoothstep(.01,.08,uScan)*exp(-pow((position.y-(uScan*5.-2.5))*9.,2.));
 vColor=color*(.78+twinkle*.26)+vec3(.3,.56,.5)*scan*.8;
 vAlpha=mix(.35,.76,gather)*(aData.z>1.5?.9:1.);
 vTwinkle=twinkle;
 gl_PointSize=clamp(aData.y*uPointScale*uPixelRatio*(7./-mvPosition.z)*(1.+scan*.45),.65,7.);
}`;
export const fragmentShader = `
varying vec3 vColor;
varying float vAlpha;
varying float vTwinkle;
void main(){
 float d=length(gl_PointCoord-.5)*2.;if(d>1.) discard;
 float core=exp(-d*d*7.5);
 float halo=pow(1.-d,2.)*.15;
 gl_FragColor=vec4(vColor*(.85+core*.4), (core+halo)*vAlpha);
}`;
