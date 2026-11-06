"""One frozen Windows source-GUI gap run; existing encrypted inputs only."""
from pathlib import Path, PurePosixPath
import base64
import hashlib
import json
import os
import subprocess
import sys
import traceback
import zipfile
import time
import re

HERE = Path(__file__).resolve().parent
WORK = Path(os.environ['RUNNER_TEMP']) / 'omc-optimization-r20'
WORK.mkdir(exist_ok=False)
REPORTS = WORK / 'reports'
REPORTS.mkdir()
ENCRYPTED = WORK / 'encrypted'
ENCRYPTED.mkdir()
TRANSPORT = WORK / 'transport.cjs'
TRANSPORT.write_bytes(subprocess.run(['git', 'show', 'HEAD:final19/transport.cjs'], cwd=HERE.parent,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout)
if hashlib.sha256(TRANSPORT.read_bytes()).hexdigest() != '19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f':
    raise RuntimeError('TRANSPORT_IDENTITY')
env = dict(os.environ)
for key in ('OMC_PREVIEW15_TRANSPORT_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'):
    env.pop(key, None)
env.update({'ELECTRON_SKIP_BINARY_DOWNLOAD': '1', 'PYTHONDONTWRITEBYTECODE': '1',
            'npm_config_audit': 'false'})
stages = []
status = 'FAIL_SOURCE_JPEG_GAP'

def stage(name, command, cwd=WORK, timeout=240, private=False):
    started = time.monotonic()
    r = subprocess.run(command, cwd=cwd, env=os.environ if private else env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    (REPORTS / (name + '.log')).write_bytes(r.stdout)
    row = {'stage': name, 'exit': r.returncode, 'seconds': round(time.monotonic()-started, 3)}
    stages.append(row)
    print(json.dumps(row), flush=True)
    if r.returncode:
        # Core tests use repository-owned synthetic fixtures; reveal only the
        # bounded test titles, never assertion bodies, paths or source stacks.
        if name in ('core','browser-preview'):
            titles=re.findall(r'(?m)^(?:not ok \d+ - |\u2716 )([^\r\n]{1,180})',r.stdout.decode('utf-8','replace'))
            titles=[title for title in titles if '://' not in title and ':\\' not in title][:12]
            print(json.dumps({'failedTestStage':name,'failedTestTitles':titles}),flush=True)
        raise RuntimeError('STAGE_FAILED:' + name)

def decrypt(cipher, manifest, identity, target):
    stage('authenticate-' + identity, ['node', str(TRANSPORT), 'decrypt', '--input', str(cipher),
        '--manifest', str(manifest), '--id', identity, '--output', str(target)], private=True)

try:
    if sys.platform not in ('win32','darwin') or os.environ.get('GITHUB_REPOSITORY') != 'Siiiiimon123/OMC-build-checks' or os.environ.get('GITHUB_REF') != 'refs/heads/verify-optimization20' or os.environ.get('GITHUB_RUN_ATTEMPT') != '1':
        raise RuntimeError('STANDARD_NATIVE_SCOPE')
    cipher = WORK / 'source.enc'
    with cipher.open('xb') as f:
        for i in range(14):
            f.write((HERE / ('source.part%02d.enc' % i)).read_bytes())
    archive = WORK / 'source.zip'
    decrypt(cipher, HERE / 'source.transport.json', 'source-r20', archive)
    source = WORK / 'source'
    source.mkdir()
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            p = PurePosixPath(item.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in item.filename or item.file_size > 16*1024**2:
                raise RuntimeError('SOURCE_ARCHIVE_MEMBER')
        z.extractall(source)
    if sys.platform == 'darwin':
        (WORK/'baseline-jpegSaturation.mjs').write_bytes((source/'src/services/jpegSaturation.js').read_bytes())
    overlay_cipher = WORK / 'overlay.enc'
    overlay_cipher.write_bytes(base64.b64decode((HERE / 'overlay.b64').read_text(encoding='ascii'), validate=True))
    overlay_zip = WORK / 'overlay.zip'
    decrypt(overlay_cipher, HERE / 'overlay.transport.json', 'r20-overlay', overlay_zip)
    with zipfile.ZipFile(overlay_zip) as z:
        for row in json.loads(z.read('PATCH.json')):
            p = PurePosixPath(row['path'])
            if p.is_absolute() or '..' in p.parts or '\\' in row['path']:
                raise RuntimeError('OVERLAY_PATH')
            target = source / row['path']
            if (target.exists() if row['beforeSha256'] is None else not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != row['beforeSha256']):
                raise RuntimeError('OVERLAY_BASE')
            data = z.read(row['path'])
            if hashlib.sha256(data).hexdigest() != row['sha256']:
                raise RuntimeError('OVERLAY_BYTES')
            target.write_bytes(data)
    rows = sorted([[p.relative_to(source).as_posix(), hashlib.sha256(p.read_bytes()).hexdigest()]
                   for p in source.rglob('*') if p.is_file()], key=lambda x: x[0])
    digest = hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()
    expected = json.loads((HERE / 'engine-baseline-input.json').read_bytes())
    if expected['sourceTree'] != 'c1211e63d60ffff22bfdd4275ae4a84ffca82dee' or len(rows) != 935 or digest != 'a0427d54f1718bdc2886fe4f00842b219413d7f6486924cfc25d796229d50cc7':
        raise RuntimeError('FROZEN_SOURCE_IDENTITY')
    (REPORTS / 'FROZEN_INPUTS.json').write_text(json.dumps({**expected,
        'verifiedSourcePathSha256Digest': digest, 'controlCommit': os.environ.get('GITHUB_SHA'),
        'unchangedSaturationKernelChecksRun': 42183690840,
        'sourceChecksRequiredForChangedUi': True, 'newGuiGapOnly': True}), encoding='utf-8')
    env['OMC_QA_SOURCE_TREE'] = expected['sourceTree']
    prior = HERE.parent / 'jpeg19-source'
    assets = json.loads((prior / 'INPUT.json').read_bytes())['assets']
    fixtures = []
    for identity, size, sha in [('sample-a', 2534841, 'f959a2cf7a3a787934a669dfde25ba112dec5d65f5086c77b26aad80ea664959'),
                               ('sample-b', 5157560, '54f911884c2c28e7c4d9a706e0ae0675949fc8d6a249a4b9575934fbcad34314')]:
        asset = next(a for a in assets if a['id'] == identity)
        if asset['plaintextBytes'] != size or asset['plaintextSha256'] != sha:
            raise RuntimeError('APPROVED_PHOTO_MANIFEST')
        parts = sorted((prior / 'inputs' / identity).glob('*.enc'))
        if len(parts) != (asset['ciphertextBytes'] + 65535)//65536:
            raise RuntimeError('PHOTO_PART_COUNT')
        cipher = WORK / (identity + '.enc')
        with cipher.open('xb') as f:
            for i, part in enumerate(parts):
                if part.name != str(i).zfill(4) + '.enc':
                    raise RuntimeError('PHOTO_PART_ORDER')
                f.write(part.read_bytes())
        manifest = WORK / (identity + '.transport.json')
        manifest.write_text(json.dumps({'schema': 'omc-aes256gcm-build-transport-v1', 'assets': [asset]}), encoding='utf-8')
        fixture = WORK / (identity + '.jpg')
        decrypt(cipher, manifest, identity, fixture)
        if fixture.stat().st_size != size or hashlib.sha256(fixture.read_bytes()).hexdigest() != sha:
            raise RuntimeError('PHOTO_PLAINTEXT_BYTES')
        fixtures.append(fixture)
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    stage('dependencies', [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], source, 300)
    stage('core', [npm, 'run', 'test:core'], source, 180)
    stage('browser-preview', [npm, 'run', 'test:browser-preview'], source, 120)
    if hashlib.sha256((source/'src/services/jpegSaturation.js').read_bytes()).hexdigest()!='bf768defff1233f174052e793bddbd325da3ceb0ce4355ec724df2317b5598cd':
        raise RuntimeError('INHERITED_PIXEL_KERNEL_CHANGED')
    (REPORTS / 'UNCHANGED_PIXEL_KERNEL_PROOF.json').write_text(json.dumps({
        'run':42204835316,'onlyCpuKernelBytesUnchangedAndInherited':True,
        'notInheritanceOfNewUiOrService':True}), encoding='utf-8')
    previous = source / 'preview-manifest.json'
    if previous.exists():
        previous.rename(REPORTS / 'previous-preview-manifest.json')
    stage('build-browser-preview', [npm, 'run', 'build:browser-preview'], source, 180)
    env.pop('ELECTRON_SKIP_BINARY_DOWNLOAD', None)
    stage('electron-runtime', ['node', 'node_modules/electron/install.js'], source, 180)
    case = REPORTS / 'native-jpeg-race'
    case.mkdir()
    stage('native-continuous-and-switch-gap', ['node', str(HERE / 'cloud-jpeg-timing.mjs'), str(source), str(case), *map(str, fixtures)], source, 420)
    result = json.loads((case / 'evidence/JPEG_RACE.json').read_bytes())
    status = result['status']
    if not status.startswith('FAIL'):
        # These components changed in this source: cover the real modal group
        # editor and finished JPEG path with the existing generated near-pair.
        # No held/injected worker result or earlier neutral-display matrix.
        env.update({'OMC_R20_TIMING_ONLY':'0','OMC_R20_FINISHED_FLOW':'0',
                    'OMC_R20_FAST_DISPLAY':'0','OMC_R20_VIEWPORT':'compact'})
        finished_case = REPORTS / 'native-synthetic'
        finished_case.mkdir()
        stage('source-modal-group-and-finished-export', ['node',str(HERE / 'cloud-finished-run.mjs'),
            str(source),str(finished_case)], source, 600)
except Exception:
    status = 'FAIL_SOURCE_JPEG_GAP'
    (REPORTS / 'controller-error.log').write_text(traceback.format_exc(), encoding='utf-8')
finally:
    # Publish only bounded anonymous assertion/parameter metadata. Private GUI
    # state, images, DOM, paths and source exceptions remain encrypted below.
    gui_path = REPORTS / 'native-jpeg-race/evidence/JPEG_RACE.json'
    if gui_path.is_file():
        gui = json.loads(gui_path.read_bytes())
        code = re.match(r'^Error: ([A-Z][A-Z0-9_:]*)', str(gui.get('error', '')))
        safe = {'sourceTree':gui.get('sourceTree'), 'resultStatus':gui.get('status'),
            'failedStage':gui.get('failedStage'), 'errorCode':code.group(1) if code else None,
            'originalsUnchanged':gui.get('originalsUnchanged'),
            'overlap':gui.get('overlap'), 'checkedSaveableBFrames':gui.get('checkedSaveableBFrames')}
        safe['overlap'] = {key:value for key,value in (safe['overlap'] or {}).items()
            if key in ('pendingAObserved','status','successfulLateResultObserved')}
        if gui.get('bReopened'):
            safe['bReopened'] = {key:gui['bReopened'].get(key) for key in ('ev','saturation','texture')}
        safe['timingObservations']=gui.get('timingObservations')
        safe['duringDrag']={key:(gui.get('duringDrag') or {}).get(key) for key in ('width','height','displayWidth','displayHeight','devicePixelRatio','quality','busy')}
        safe['afterDrag']={key:(gui.get('afterDrag') or {}).get(key) for key in ('width','height','displayWidth','displayHeight','devicePixelRatio','quality','busy')}
        print(json.dumps({'jpegGuiOutcome':safe}),flush=True)
    finished_path=REPORTS / 'native-synthetic/evidence/FINISHED_FLOW.json'
    if finished_path.is_file():
        finished=json.loads(finished_path.read_bytes())
        print(json.dumps({'sourceGroupExportOutcome':{
            'status':finished.get('status'),'originalsUnchanged':finished.get('originalsUnchanged'),
            'exportedCount':len(finished.get('exported',[])),
            'persistentExportStatusVerified':finished.get('persistentExportStatusVerified')
        }}),flush=True)
    (REPORTS / 'SUMMARY.json').write_text(json.dumps({'status': status, 'platform': sys.platform,
        'stages': stages, 'sourceTree': 'c1211e63d60ffff22bfdd4275ae4a84ffca82dee',
        'memberPhotos': ['sample-a', 'sample-b'], 'scriptDrivenRealGui': True,
        'installedPackageTested': False, 'completeAiTested': False, 'realThousandTested': False,
        'published': False}), encoding='utf-8')
    packed = WORK / 'reports.zip'
    with zipfile.ZipFile(packed, 'x', compression=zipfile.ZIP_DEFLATED) as z:
        for f in sorted(REPORTS.rglob('*')):
            rel = f.relative_to(REPORTS)
            root = len(rel.parts) == 1 and f.suffix in ('.json', '.log')
            native = len(rel.parts) == 3 and rel.parts[0] in ('native-jpeg-race','native-synthetic') and rel.parts[1] == 'evidence'
            allowed = native and (f.suffix == '.json' or f.name in ('jpeg-race-continuous.png', 'jpeg-race-b-refined.png', 'jpeg-race-b-reopened.png','photo-grid.png','group-crop.png','adjusted-refined.png'))
            if f.is_file() and (root or allowed):
                if f.stat().st_size > 4*1024**2:
                    raise RuntimeError('EVIDENCE_MEMBER_BOUND')
                z.write(f, rel.as_posix())
    if packed.stat().st_size > 16*1024**2:
        raise RuntimeError('EVIDENCE_TOTAL_BOUND')
    subprocess.run(['node', str(TRANSPORT), 'encrypt', '--input', str(packed), '--output', str(ENCRYPTED / 'reports.enc'),
        '--manifest', str(ENCRYPTED / 'REPORTS_READY.json'), '--id', 'r20-reports'], check=True)
    print(json.dumps({'status': status}), flush=True)
sys.exit(1 if status.startswith('FAIL') else 0)
