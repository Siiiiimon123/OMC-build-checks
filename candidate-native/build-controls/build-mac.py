"""Repack the accepted Mac20 runtime with current application code on the owned VM."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,os,plistlib,shutil,stat,subprocess,sys
from pkg_contract_adapter import build_nonrelocatable_pkg,verify_expanded_contract,normalize_install_permissions

def sha(file):
    with Path(file).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def save(file,value):
    with Path(file).open('x',encoding='utf8') as stream:json.dump(value,stream,indent=2);stream.write('\n')
def inventory(root):
    rows={}
    for p in sorted(Path(root).rglob('*')):
        mode=p.lstat().st_mode;name=p.relative_to(root).as_posix()
        if stat.S_ISLNK(mode):rows[name]={'kind':'symlink','target':os.readlink(p)}
        elif stat.S_ISREG(mode):rows[name]={'kind':'file','bytes':p.stat().st_size,'sha256':sha(p),'executeBits':mode&0o111}
        elif stat.S_ISDIR(mode):rows[name]={'kind':'directory'}
        else:raise AssertionError('UNEXPECTED_PAYLOAD_TYPE')
    return rows
def main():
    assert sys.platform=='darwin' and os.environ.get('GITHUB_ACTIONS')=='true'
    assert os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF')=='refs/heads/verify-native-candidate'
    source,base,inputs,work=map(Path,sys.argv[1:]);assert len(sys.argv)==5
    assert not work.exists() and work.resolve().is_relative_to(Path(os.environ['RUNNER_TEMP']).resolve())
    assert base.stat().st_size==991719638 and sha(base)=='c410173d2ec9088895e6d8d02c6a55785ae5c7e6a30f74ca585ffa05f3281b3b'
    work.mkdir();reports=work/'reports';reports.mkdir()
    clean={k:v for k,v in os.environ.items() if k not in ('GH_TOKEN','GITHUB_TOKEN','OMC_PREVIEW15_TRANSPORT_KEY')}
    def run(label,argv,allow_failure=False):
        print(json.dumps({'phase':label}),flush=True)
        with (reports/(label+'.log')).open('xb') as stream:
            p=subprocess.run(list(map(str,argv)),stdout=stream,stderr=subprocess.STDOUT,env=clean,cwd=source,timeout=900)
        assert p.returncode==0 or allow_failure,label+'_FAILED'
    expanded=work/'baseline-expanded';run('expand-accepted-mac20',['/usr/sbin/pkgutil','--expand-full',base,expanded])
    matches=[p for p in expanded.rglob('*.app') if (p/'Contents/Resources/app.asar').is_file()]
    assert len(matches)==1 and matches[0].name=='OMC-Preview.app'
    output=work/'output';output.mkdir();app=output/'OMC-Preview.app';matches[0].rename(app)
    shutil.rmtree(expanded)
    assert sha(app/'Contents/Resources/app.asar')=='fef9b673eeca088459d13aeba79a7cec9647ccb2e1225786c3a4298775312a43'
    before=inventory(app)
    # Remove only Electron's known sample entry inside this newly assembled VM app.
    default_entry=app/'Contents/Resources/default_app.asar'
    removed_default=None
    if default_entry.exists():
        assert default_entry.is_file() and not default_entry.is_symlink()
        removed_default={'bytes':default_entry.stat().st_size,'sha256':sha(default_entry)}
        default_entry.unlink()
    assert not (app/'Contents/Resources/app').exists(),'UNEXPECTED_UNPACKED_ENTRY'
    save(reports/'REMOVED_DEFAULT_ENTRY.json',{'removed':removed_default,'scope':'owned VM build only'})
    run('rebuild-current-frontend',['node',Path(__file__).with_name('rebuild-mac-asar.cjs'),source,app,inputs,work,reports])
    plist=app/'Contents/Info.plist';info=plistlib.loads(plist.read_bytes())
    assert info['CFBundleIdentifier']=='com.omc.photo-select'
    info['CFBundleShortVersionString']='1.0.21-preview.25';info['CFBundleVersion']='1.0.21.25'
    frontend=json.loads((reports/'FRONTEND_REBUILD.json').read_bytes())
    assert 'Resources/app.asar' in info['ElectronAsarIntegrity']
    info['ElectronAsarIntegrity']['Resources/app.asar']={'algorithm':'SHA256','hash':frontend['asarHeaderSha256']}
    info['ElectronAsarIntegrity'].pop('Resources/default_app.asar',None)
    plist.write_bytes(plistlib.dumps(info))
    normalize_install_permissions(app,reports/'APP_INSTALL_PERMISSIONS.json')
    run('sign-outer-app',['/usr/bin/codesign','--force','--sign','-','--timestamp=none',
        '--preserve-metadata=identifier,entitlements,flags',app])
    run('verify-current-app-signature',['/usr/bin/codesign','--verify','--deep','--strict',app])
    after=inventory(app)
    modified=sorted(name for name in set(before)|set(after) if before.get(name)!=after.get(name))
    allowed={'Contents/Resources/app.asar','Contents/Info.plist','Contents/_CodeSignature/CodeResources',
             'Contents/MacOS/'+info['CFBundleExecutable'],'Contents/Resources/default_app.asar'}
    assert set(modified)<=allowed, 'PRESERVED_RUNTIME_OR_NESTED_SIGNATURE_CHANGED'
    save(reports/'UNCHANGED_RUNTIME_PROOF.json',{'status':'PASS','baselinePackageSha256':sha(base),
        'allAiSourcesIdentical':True,'backendRebuilt':False,'changedOuterAppMembers':modified,
        'allOtherPayloadMembersIdentical':True})
    run('verify-prepackage-entry',['node',Path(__file__).with_name('verify-mac-entry.cjs'),source,app,frontend['asarSha256'],reports/'PREPACKAGE_ENTRY.json'])
    pkg=output/'OMC-Preview-1.0.21-preview.25-mac-arm64-unsigned.pkg'
    shutil.rmtree(work/'asar-input')
    (work/'current-app.asar').unlink()
    build_nonrelocatable_pkg(app,work,pkg,run,reports)
    shutil.rmtree(work/'nonrelocatable-pkg-build')
    expanded_final=work/'final-pkg-expanded'
    run('expand-final-pkg',['/usr/sbin/pkgutil','--expand',pkg,expanded_final]);verify_expanded_contract(expanded_final,reports)
    # Leave installation to the upgrade driver after the frozen legacy package is exercised.
    save(reports/'EXPECTED_PAYLOAD.json',inventory(app))
    shutil.rmtree(expanded_final)
    shutil.rmtree(app)
    save(reports/'BUILD_RESULT.json',{'status':'PASS_INCREMENTAL_BUILD_PENDING_INSTALL',
        'sourceTree':'6d0e522c198abd0e8ee47d1d25f11d188b101789','version':'1.0.21-preview.25',
        'package':{'path':str(pkg),'bytes':pkg.stat().st_size,'sha256':sha(pkg)},
        'asarSha256':frontend['asarSha256'],'expectedPayload':'EXPECTED_PAYLOAD.json',
        'backendRebuilt':False,'notarized':False,'developerIdSigned':False,'fullAiAccepted':False})
if __name__=='__main__':main()
