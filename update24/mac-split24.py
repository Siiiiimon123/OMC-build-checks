"""Apple-native offline PKG with an immutable runtime component."""
from pathlib import Path
import hashlib
import json
import os
import plistlib
import shutil
import stat
import subprocess
import sys
import xml.etree.ElementTree as xml

APP = Path('/Applications/OMC-Preview.app')
CORE_FILES = (
    'Contents/Info.plist',
    'Contents/MacOS/OMC-Preview',
    'Contents/Resources/app.asar',
    'Contents/_CodeSignature/CodeResources',
)
RUNTIME_ID = 'com.omc.photo-select.preview.runtime'
CORE_ID = 'com.omc.photo-select.preview.core'

def sha(file):
    with Path(file).open('rb') as data:
        return hashlib.file_digest(data,'sha256').hexdigest()

def inventory(root):
    rows = {}
    for p in sorted(root.rglob('*')):
        mode = p.lstat().st_mode
        rel = p.relative_to(root).as_posix()
        if stat.S_ISLNK(mode):
            rows[rel] = ('link',os.readlink(p))
        elif stat.S_ISDIR(mode):
            rows[rel] = ('dir',)
        elif stat.S_ISREG(mode):
            rows[rel] = ('file',p.stat().st_size,sha(p),mode & 0o111)
        else:
            raise AssertionError('UNEXPECTED_APP_MEMBER')
    return rows

def main():
    assert sys.platform == 'darwin' and os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REPOSITORY') == 'Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/verify-update24-mac-layout'
    base, stock, work, receipt = map(Path,sys.argv[1:])
    temp = Path(os.environ['RUNNER_TEMP']).resolve()
    for file in (base,stock,work,receipt):
        assert file.resolve().is_relative_to(temp) and not file.is_symlink()
    assert not work.exists() and not APP.exists()
    work.mkdir()
    components = work/'components'; components.mkdir()
    evidence = {}

    def command(name,*args):
        print(json.dumps({'phase':name}),flush=True)
        subprocess.run(list(map(str,args)),check=True,timeout=900)

    def remove(folder):
        assert folder.resolve().is_relative_to(work.resolve()) and not folder.is_symlink()
        shutil.rmtree(folder)

    def stage_original(package,label,expected_version):
        assert package.is_file()
        size, fingerprint = package.stat().st_size, sha(package)
        exploded = work/('expanded-'+label)
        command('expand-original-'+label,'/usr/sbin/pkgutil','--expand-full',package,exploded)
        matches = [p for p in exploded.rglob('OMC-Preview.app') if (p/'Contents/Resources/app.asar').is_file()]
        assert len(matches)==1
        app = matches[0]
        metadata = plistlib.loads((app/'Contents/Info.plist').read_bytes())
        assert metadata['CFBundleIdentifier']=='com.omc.photo-select'
        assert metadata['CFBundleShortVersionString']==expected_version
        assert metadata['CFBundleExecutable']=='OMC-Preview'
        rows = inventory(app)
        core = work/('core-'+label); core.mkdir()
        for rel in CORE_FILES:
            source = app/rel
            assert source.is_file() and not source.is_symlink()
            dest = core/rel
            dest.parent.mkdir(parents=True,exist_ok=True)
            source.rename(dest)
        evidence[label] = {'version':expected_version,'originalPackageSha256':fingerprint,'originalPackageBytes':size,
            'appMembers':len(rows),'asarSha256':rows['Contents/Resources/app.asar'][2]}
        return exploded,app,core,rows

    older,_,old_core,old_rows = stage_original(base,'bootstrap','1.0.21-preview.23')
    remove(older)
    base.unlink()  # authenticated input remains in its original GitHub artifact
    newer,app,new_core,new_rows = stage_original(stock,'candidate','1.0.21-preview.24')
    difference = {p for p in set(old_rows)|set(new_rows) if old_rows.get(p)!=new_rows.get(p)}
    assert difference <= set(CORE_FILES), 'RUNTIME_IS_NOT_IDENTICAL'
    assert inventory(app) == {p:row for p,row in new_rows.items() if p not in CORE_FILES}
    stock.unlink()  # stock candidate remains in its original GitHub artifact

    def build_component(root, package, identifier, version):
        definition = work/(package.stem+'.plist')
        command('analyze-'+package.stem,'/usr/bin/pkgbuild','--analyze','--root',root,definition)
        scanned = plistlib.loads(definition.read_bytes())
        def fixed(value):
            if isinstance(value,list):
                for item in value: fixed(item)
            if isinstance(value,dict):
                if 'RootRelativeBundlePath' in value:
                    value['BundleIsRelocatable'] = False
                for child in value.values(): fixed(child)
        fixed(scanned)
        definition.write_bytes(plistlib.dumps(scanned))
        command('build-'+package.stem,'/usr/bin/pkgbuild','--root',root,'--install-location',APP,
            '--identifier',identifier,'--version',version,'--ownership','recommended',
            '--component-plist',definition,package)

    runtime = components/'runtime.pkg'
    build_component(app,runtime,RUNTIME_ID,'1.0.21')
    runtime_sha = sha(runtime)
    remove(newer)
    outputs = {}
    for label,core,version in [('bootstrap',old_core,'1.0.21.23'),('candidate',new_core,'1.0.21.24')]:
        part = components/('core-'+label+'.pkg')
        build_component(core,part,CORE_ID,version)
        remove(core)
        definition = work/(label+'.xml')
        command('distribution-'+label,'/usr/bin/productbuild','--synthesize','--package',runtime,'--package',part,definition)
        tree = xml.parse(definition)
        root = tree.getroot()
        for choice in root.findall('choice'):
            refs = choice.findall('pkg-ref')
            if refs:
                choice.set('visible','false')
                choice.set('enabled','false')
                choice.set('selected','true')
        refs = {p.attrib['id'] for p in root.findall('pkg-ref')}
        assert refs == {RUNTIME_ID,CORE_ID}, 'REQUIRED_COMPONENT_CHOICES'
        tree.write(definition,encoding='utf-8',xml_declaration=True)
        out = work/('OMC-Preview-'+version+'.pkg')
        command('wrap-'+label,'/usr/bin/productbuild','--distribution',definition,'--package-path',components,out)
        assert sha(runtime)==runtime_sha, 'SHARED_RUNTIME_REWRITTEN'
        outputs[label] = {'path':str(out),'bytes':out.stat().st_size,'sha256':sha(out)}
        part.unlink()
    remove(components)

    actual = Path(outputs['candidate']['path'])
    command('first-install-split-candidate','sudo','/usr/sbin/installer','-pkg',actual,'-target','/')
    assert APP.is_dir()
    command('verify-split-app-signature','/usr/bin/codesign','--verify','--deep','--strict',APP)
    installed_rows = inventory(APP)
    assert new_rows==installed_rows, 'INSTALLED_APP_CHANGED_IN_SPLIT_LAYOUT'
    receipt.write_text(json.dumps({'status':'PASS_MAC_NATIVE_SPLIT_PACKAGE_FIRST_INSTALL',
        'originals':evidence,'sharedComponentSha256':runtime_sha,'differentCoreFiles':sorted(difference),
        'sameInstalledPayload':True,'productionEndpointUsed':False,'packages':outputs},indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    main()
