"""Source-only cloud regression. No photo/model/runtime download or publication."""
from pathlib import Path, PurePosixPath
import hashlib
import base64
import json
import os
import subprocess
import sys
import time
import zipfile

HERE=Path(__file__).resolve().parent
WORK=Path(os.environ['RUNNER_TEMP'])/'omc-optimization-r20'
WORK.mkdir(exist_ok=False)
REPORTS=WORK/'reports';REPORTS.mkdir()
ENCRYPTED=WORK/'encrypted';ENCRYPTED.mkdir()
TRANSPORT=WORK/'transport.cjs'
raw_transport=subprocess.run(['git','show','HEAD:final19/transport.cjs'],cwd=HERE.parent,
                             stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
TRANSPORT.write_bytes(raw_transport)
EXPECTED_TRANSPORT='19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
if hashlib.sha256(TRANSPORT.read_bytes()).hexdigest()!=EXPECTED_TRANSPORT:
    raise RuntimeError('TRANSPORT_IDENTITY_MISMATCH')
child_env=dict(os.environ)
child_env.pop('OMC_PREVIEW15_TRANSPORT_KEY',None)
child_env.pop('GH_TOKEN',None)
child_env.pop('GITHUB_TOKEN',None)
child_env['PYTHONDONTWRITEBYTECODE']='1'
child_env['ELECTRON_SKIP_BINARY_DOWNLOAD']='1'
child_env['npm_config_audit']='false'
stages=[]

def stage(name, command, cwd=WORK, timeout=300, private_env=False):
    start=time.monotonic()
    result=subprocess.run(command,cwd=cwd,env=os.environ if private_env else child_env,
                          stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    (REPORTS/(name+'.log')).write_bytes(result.stdout)
    row={'stage':name,'exit':result.returncode,'seconds':round(time.monotonic()-start,3)}
    stages.append(row)
    print(json.dumps(row),flush=True)
    return result.returncode==0

ok=False
try:
    archive=WORK/'source.zip'
    cipher=WORK/'source.enc'
    with cipher.open('xb') as output:
        for index in range(14):
            output.write((HERE/('source.part%02d.enc'%index)).read_bytes())
    if not stage('authenticate-source',['node',str(TRANSPORT),'decrypt','--input',str(cipher),
        '--manifest',str(HERE/'source.transport.json'),'--id','source-r20','--output',str(archive)],private_env=True):
        raise RuntimeError('SOURCE_AUTHENTICATION_FAILED')
    source=WORK/'source';source.mkdir()
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            p=PurePosixPath(item.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in item.filename or not item.filename or item.file_size>16*1024*1024:
                raise RuntimeError('INVALID_SOURCE_ARCHIVE')
        z.extractall(source)
    (WORK/'baseline-imageAnalyzer.js').write_bytes((source/'src/services/imageAnalyzer.js').read_bytes())
    if (HERE/'overlay.enc').exists():
        overlay=WORK/'overlay.zip'
        overlay_cipher=HERE/'overlay.enc'
        if (HERE/'overlay.b64').exists():
            overlay_cipher=WORK/'overlay.enc'
            overlay_cipher.write_bytes(base64.b64decode((HERE/'overlay.b64').read_text(encoding='ascii'),validate=True))
        if not stage('authenticate-overlay',['node',str(TRANSPORT),'decrypt','--input',str(overlay_cipher),
            '--manifest',str(HERE/'overlay.transport.json'),'--id','r20-overlay','--output',str(overlay)],private_env=True):
            raise RuntimeError('OVERLAY_AUTHENTICATION_FAILED')
        with zipfile.ZipFile(overlay) as z:
            rows=json.loads(z.read('PATCH.json'))
            for row in rows:
                p=PurePosixPath(row['path'])
                if p.is_absolute() or '..' in p.parts or '\\' in row['path']:
                    raise RuntimeError('INVALID_OVERLAY_PATH')
                target=source/row['path']
                if hashlib.sha256(target.read_bytes()).hexdigest()!=row['beforeSha256']:
                    raise RuntimeError('OVERLAY_BASE_MISMATCH')
                data=z.read(row['path'])
                if hashlib.sha256(data).hexdigest()!=row['sha256']:
                    raise RuntimeError('OVERLAY_BYTES_MISMATCH')
                target.write_bytes(data)
    npm='npm.cmd' if os.name=='nt' else 'npm'
    if not stage('dependencies',[npm,'ci','--ignore-scripts','--no-audit','--no-fund'],source,timeout=420):
        raise RuntimeError('DEPENDENCY_PREPARATION_FAILED')
    targeted=['src/services/analysisPerformance.test.js','src/services/conservativeAutomaticReview.test.js',
        'src/services/automaticReviewStripStats.test.js','src/services/automaticAdjustmentPreview.test.js',
        'src/services/jpegPreviewRenderer.test.js','src/workers/jpegAdjustmentPreview.worker.test.js',
        'src/services/ai/enhancedAnalysisTermination.test.js','src/services/ai/analysisIntegrityRegression.test.js',
        'src/services/ai/modelLoaderBatch.test.js','src/services/imageAnalyzer.test.js']
    timing_only=os.environ.get('OMC_R20_TIMING_ONLY')=='1'
    native_ui=os.environ.get('OMC_R20_NATIVE_UI')=='1'
    if native_ui:
        # The prior frozen source passed full regressions. Only the additional
        # viewport policy changed; test that delta and the real native flow.
        targeted=['src/services/jpegExposureService.test.js','src/services/jpegExposureServiceV2.test.js',
                  'src/services/jpegPreviewRenderer.test.js','src/services/savedAdjustmentPreview.test.js']
    checks=[stage('targeted',['node','--test',*targeted],source)]
    if not native_ui:
        checks.extend([stage('core',[npm,'run','test:core'],source),
                       stage('browser-preview',[npm,'run','test:browser-preview'],source)])
    checks.append(stage('build',[npm,'run','build'],source))
    previous=source/'preview-manifest.json'
    if previous.exists():
        previous.rename(REPORTS/'previous-preview-manifest.json')
    checks.append(stage('prepare-preview',['node','scripts/startBrowserPreview.mjs','--prepare'],source))
    if not native_ui:
        if stage('python-dependency',[sys.executable,'-m','pip','install','--disable-pip-version-check',
            '--no-cache-dir','numpy==2.5.0rc1'],timeout=180):
            checks.append(stage('python-regression',[sys.executable,'-m','unittest','discover',
                '-s','ai-training/tests','-p','test_technical_probability_precision.py'],source))
        else:
            checks.append(False)
    if timing_only and all(checks):
        checks.append(stage('fair-grouping-kernel-benchmark',['node',str(HERE/'benchmark-grouping.mjs'),str(source),str(WORK/'baseline-imageAnalyzer.js'),str(REPORTS/'GROUPING_KERNEL_BENCH.json')],timeout=120))
    if not timing_only and (HERE/'readout-input.json').exists() and all(checks):
        checks.append(stage('grouping-kernel-benchmark',['node',str(HERE/'benchmark-grouping.mjs'),
            str(source),str(WORK/'baseline-imageAnalyzer.js'),str(REPORTS/'GROUPING_KERNEL_BENCH.json')],timeout=120))
        checks.append(stage('prior-native-evidence-readout',['node',str(HERE/'thin-evidence.cjs'),
            str(source),str(TRANSPORT),str(HERE/'readout-input.json'),str(REPORTS)],timeout=360,private_env=True))
    if native_ui and all(checks):
        child_env.pop('ELECTRON_SKIP_BINARY_DOWNLOAD',None)
        if not stage('electron-runtime',['node','node_modules/electron/install.js'],source,timeout=300):
            raise RuntimeError('ELECTRON_PREPARATION_FAILED')
        prior=HERE.parent/'jpeg19-source'
        prior_inputs=json.loads((prior/'INPUT.json').read_bytes())
        for asset in prior_inputs['assets']:
            if asset['id'] not in ('sample-a','sample-b'):
                continue
            cipher=WORK/(asset['id']+'.enc')
            parts=sorted((prior/'inputs'/asset['id']).glob('*.enc'))
            if len(parts)!=(asset['ciphertextBytes']+65535)//65536:
                raise RuntimeError('APPROVED_PHOTO_INPUT_MISSING')
            with cipher.open('xb') as output:
                for i,part in enumerate(parts):
                    if part.name!=str(i).zfill(4)+'.enc':
                        raise RuntimeError('PHOTO_PART_ORDER')
                    output.write(part.read_bytes())
            manifest=WORK/(asset['id']+'.transport.json')
            manifest.write_text(json.dumps({'schema':'omc-aes256gcm-build-transport-v1','assets':[asset]}),encoding='utf-8')
            if not stage('authenticate-'+asset['id'],['node',str(TRANSPORT),'decrypt','--input',str(cipher),
                '--manifest',str(manifest),'--id',asset['id'],'--output',str(WORK/(asset['id']+'.jpg'))],private_env=True):
                raise RuntimeError('PHOTO_AUTHENTICATION_FAILED')
        for identity in (('sample-b',) if timing_only else ('sample-a','sample-b','synthetic')):
            case=REPORTS/('native-'+identity);case.mkdir()
            child_env['OMC_R20_VIEWPORT']='compact' if identity=='sample-a' else 'wide'
            command=['node',str(HERE/'cloud-finished-run.mjs'),str(source),str(case)]
            if identity!='synthetic':
                command.append(str(WORK/(identity+'.jpg')))
            checks.append(stage('native-'+identity,command,source,timeout=420))
            if not checks[-1]:
                break
        if not timing_only and os.name=='nt' and all(checks):
            case=REPORTS/'native-stress';case.mkdir()
            child_env['OMC_R20_VIEWPORT']='compact'
            checks.append(stage('native-stress',['node',str(HERE/'cloud-stress-run.mjs'),str(source),str(case)],source,timeout=840))
    ok=all(checks)
except Exception as error:
    # Keep source-bearing exceptions private; public Actions logs show only stage status.
    import traceback
    (REPORTS/'controller-error.log').write_text(traceback.format_exc(),encoding='utf-8')
finally:
    result={'status':'PASS_SOURCE_REGRESSION_NOT_RELEASE' if ok else 'FAIL_SOURCE_REGRESSION',
            'platform':sys.platform,'stages':stages,'memberPhotosUsed':os.environ.get('OMC_R20_NATIVE_UI')=='1',
            'realThousandPhotoQualified':False,'gpuPerformanceQualified':False,
            'installerBuilt':False,'published':False}
    (REPORTS/'SUMMARY.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    packed=WORK/'reports.zip'
    with zipfile.ZipFile(packed,'x',compression=zipfile.ZIP_DEFLATED) as z:
        for file in sorted(REPORTS.rglob('*')):
            rel=file.relative_to(REPORTS)
            if not file.is_file():
                continue
            # Retain actual evidence, not browser profiles or source/export
            # fixture copies. Existing full artifacts remain available.
            root_log=len(rel.parts)==1 and file.suffix in ('.log','.json')
            readout=len(rel.parts)>1 and rel.parts[0].startswith('readout-')
            native=len(rel.parts)>=3 and rel.parts[0].startswith('native-') and rel.parts[1]=='evidence' and file.suffix=='.json'
            if root_log or readout or native:
                z.write(file,rel.as_posix())
    subprocess.run(['node',str(TRANSPORT),'encrypt','--input',str(packed),
        '--output',str(ENCRYPTED/'reports.enc'),'--manifest',str(ENCRYPTED/'REPORTS_READY.json'),
        '--id','r20-reports'],check=True)
    print(json.dumps({'status':result['status']}),flush=True)
sys.exit(0 if ok else 1)
