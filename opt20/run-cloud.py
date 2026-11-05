"""Source-only cloud regression. No photo/model/runtime download or publication."""
from pathlib import Path, PurePosixPath
import hashlib
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
    if (HERE/'overlay.enc').exists():
        overlay=WORK/'overlay.zip'
        if not stage('authenticate-overlay',['node',str(TRANSPORT),'decrypt','--input',str(HERE/'overlay.enc'),
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
    checks=[stage('targeted',['node','--test',*targeted],source),
        stage('core',[npm,'run','test:core'],source),
        stage('browser-preview',[npm,'run','test:browser-preview'],source),
        stage('build',[npm,'run','build'],source)]
    previous=source/'preview-manifest.json'
    if previous.exists():
        previous.rename(REPORTS/'previous-preview-manifest.json')
    checks.append(stage('prepare-preview',['node','scripts/startBrowserPreview.mjs','--prepare'],source))
    if stage('python-dependency',[sys.executable,'-m','pip','install','--disable-pip-version-check',
        '--no-cache-dir','numpy==2.5.0rc1'],timeout=180):
        checks.append(stage('python-regression',[sys.executable,'-m','unittest','discover',
            '-s','ai-training/tests','-p','test_technical_probability_precision.py'],source))
    else:
        checks.append(False)
    ok=all(checks)
except Exception as error:
    # Keep source-bearing exceptions private; public Actions logs show only stage status.
    import traceback
    (REPORTS/'controller-error.log').write_text(traceback.format_exc(),encoding='utf-8')
finally:
    result={'status':'PASS_SOURCE_REGRESSION_NOT_RELEASE' if ok else 'FAIL_SOURCE_REGRESSION',
            'platform':sys.platform,'stages':stages,'memberPhotosUsed':False,
            'realThousandPhotoQualified':False,'gpuPerformanceQualified':False,
            'installerBuilt':False,'published':False}
    (REPORTS/'SUMMARY.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    packed=WORK/'reports.zip'
    with zipfile.ZipFile(packed,'x',compression=zipfile.ZIP_DEFLATED) as z:
        for file in sorted(REPORTS.iterdir()):
            z.write(file,file.name)
    subprocess.run(['node',str(TRANSPORT),'encrypt','--input',str(packed),
        '--output',str(ENCRYPTED/'reports.enc'),'--manifest',str(ENCRYPTED/'REPORTS_READY.json'),
        '--id','r20-reports'],check=True)
    print(json.dumps({'status':result['status']}),flush=True)
sys.exit(0 if ok else 1)