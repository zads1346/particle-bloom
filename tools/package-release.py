"""Create bounded, inspectable release ZIPs. Does not publish or install anything."""
from pathlib import Path
import hashlib, json, sys, zipfile
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT.parent/'particle-bloom-release'
OUT.mkdir(parents=True,exist_ok=True)
FORBIDDEN={'.git','.openai','.env','node_modules','__pycache__','.venv-render','.offline-render-linux','.codex','.agents'}
STAMP=(2026,10,10,0,0,0)
def collect(folder):
    return sorted(p for p in folder.rglob('*') if p.is_file() and not p.is_symlink() and not any(x in FORBIDDEN or x.startswith('.env') for x in p.relative_to(ROOT).parts))
def write_zip(name,entries):
    target=OUT/name
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for source,destination in sorted(entries,key=lambda x:x[1]):
            if not source.is_file() or source.is_symlink(): raise ValueError(f'Invalid input: {source}')
            info=zipfile.ZipInfo(destination,STAMP);info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16
            archive.writestr(info,source.read_bytes())
    with zipfile.ZipFile(target) as archive:
        if archive.testzip(): raise ValueError('ZIP integrity failure')
        names=archive.namelist()
        if any(any(p in FORBIDDEN or p.startswith('.env') for p in Path(name).parts) for name in names): raise ValueError('Forbidden path in ZIP')
    return {'file':target.name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':len(entries)}
root_files=['.gitignore','README.md','VALIDATION.md','THIRD_PARTY_NOTICES.md','index.html','package.json','package-lock.json','vite.config.js','playwright.config.js']
source=[(ROOT/name,'particle-bloom-source/'+name) for name in root_files]
for directory in ['src','public','tests','tools','release']:
    source.extend((p,'particle-bloom-source/'+p.relative_to(ROOT).as_posix()) for p in collect(ROOT/directory))
source.append((ROOT/'artifacts/offline-shader-study.png','particle-bloom-source/artifacts/offline-shader-study.png'))
for name in ['offline-sixflower-preview.png','offline-sixflower-preview.json']:
    source.append((ROOT/'artifacts'/name,'particle-bloom-source/artifacts/'+name))
if not (ROOT/'dist/index.html').is_file(): raise SystemExit('Run npm run build first.')
production=[(p,'particle-bloom/'+p.relative_to(ROOT/'dist').as_posix()) for p in collect(ROOT/'dist')]
for name in ['Start.cmd','server.mjs','serve.py','QUICKSTART-ZH.md']:
    production.append((ROOT/'release'/name,'particle-bloom/'+name))
production.extend([(ROOT/'VALIDATION.md','particle-bloom/VALIDATION.md'),(ROOT/'THIRD_PARTY_NOTICES.md','particle-bloom/THIRD_PARTY_NOTICES.md'),(ROOT/'release/QUICKSTART-ZH.md','particle-bloom/使用说明.txt')])
report={'version':'1.1.0','flower_types':['peony','rose','lotus','sunflower','tulip','lily'],'artifacts':[write_zip('particle-bloom-sixflowers-source.zip',source),write_zip('particle-bloom-sixflowers-windows-ready.zip',production)],'source_reference_image_included':False,'camera_requires':'localhost or HTTPS','publication_performed':False}
(OUT/'RELEASE-MANIFEST.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
