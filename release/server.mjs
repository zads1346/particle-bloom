// Dependency-free loopback-only static server for the prebuilt release.
import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.task':'application/octet-stream','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
export function makeStaticServer(root){
 const rootPath=resolve(root);
 return createServer(async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   if(pathname.split(/[\\/]/).some(segment=>segment.startsWith('.'))){res.writeHead(403);res.end('Forbidden');return;}
   const requested=resolve(rootPath,'.'+(pathname==='/'?'/index.html':pathname));
   if(!requested.startsWith(rootPath+'/')&&!requested.startsWith(rootPath+'\\')){res.writeHead(403);res.end('Forbidden');return;}
   const actual=await realpath(requested);
   if(!actual.startsWith(rootPath+'/')&&!actual.startsWith(rootPath+'\\')){res.writeHead(403);res.end('Forbidden');return;}
   const info=await stat(actual);if(!info.isFile()){res.writeHead(404);res.end('Not found');return;}
   const tag=`W/"${info.size}-${Math.floor(info.mtimeMs)}"`;
   if(req.headers['if-none-match']===tag){res.writeHead(304);res.end();return;}
   res.writeHead(200,{'Content-Type':MIME[extname(actual)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':extname(actual)==='.html'?'no-cache':'public, max-age=3600','ETag':tag,'X-Content-Type-Options':'nosniff'});
   if(req.method==='HEAD'){res.end();return;}res.end(await readFile(actual));
  }catch(e){res.writeHead(e instanceof URIError?400:404);res.end(e instanceof URIError?'Bad request':'Not found');}
 });
}
export function openBrowser(url){
 const args=process.platform==='win32'?['cmd',['/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
 execFile(args[0],args[1],()=>{});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4173);
 if(!Number.isInteger(port)||port<1024||port>65535){console.error('PORT must be an integer from 1024 to 65535.');process.exit(1);}
 const server=makeStaticServer(dirname(fileURLToPath(import.meta.url)));
 server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Close the other server or set PORT to another number.`:error.message);process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>{const url=`http://127.0.0.1:${port}/`;console.log(`Particle Bloom is ready: ${url}\nKeep this window open. Press Ctrl+C to stop.\nCamera frames stay in your browser.`);if(!process.argv.includes('--no-open'))openBrowser(url);});
}
