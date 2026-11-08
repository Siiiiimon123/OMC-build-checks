"""Reuse only two immutable Mac PKGs in a disposable cloud VM."""
import hashlib,json,os,platform,shutil,subprocess,sys,traceback,zipfile
from pathlib import Path
H=Path(__file__).resolve().parent
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def main():
    assert (sys.platform,platform.machine())==('darwin','arm64')
    assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
    assert os.environ.get('GITHUB_REF')=='refs/heads/verify-optimization20' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
    work=Path(os.environ['RUNNER_TEMP']).resolve()/'omc23-isolated-upgrade'
    assert not Path('/Applications/OMC-Preview.app').exists()
    work.mkdir(); evidence=work/'evidence';evidence.mkdir()
    output=work/'encrypted';output.mkdir()
    clean={k:v for k,v in os.environ.items() if k not in ('GH_TOKEN','GITHUB_TOKEN','OMC_PREVIEW15_TRANSPORT_KEY')}
    key={**clean,'OMC_PREVIEW15_TRANSPORT_KEY':os.environ['OMC_PREVIEW15_TRANSPORT_KEY']}
    github={**clean,'GH_TOKEN':os.environ['GH_TOKEN']}
    transport=work/'transport.cjs'
    transport.write_bytes(subprocess.check_output(['git','show','HEAD:final19/transport.cjs'],cwd=H.parent))
    assert sha(transport)=='19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f'
    result={'status':'FAIL','sourceTree':'be3c2093a1bc62ea5755f8ed49326186be980e5e',
            'controlCommit':os.environ['GITHUB_SHA'],'productionUpgradeTested':False,'tufUpdateTested':False,'rebuilt':False}
    def run(label,argv,timeout,env=clean):
        print(json.dumps({'phase':label}),flush=True)
        with (evidence/(label+'.log')).open('xb') as log:
            subprocess.run(list(map(str,argv)),env=env,cwd=work,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=timeout)
    def budget(reserve):
        used=int(subprocess.check_output(['/usr/bin/du','-sk',work],text=True).split()[0])*1024
        assert used+reserve<=5*1024**3 and shutil.disk_usage(work).free>=reserve+512*1024**2,'WORK_BUDGET'
    try:
        stage=H.parent/'native23finish'
        old=work/'old17.pkg'; new=work/'new23.pkg'; outer=work/'new.zip'
        budget(4*1024**3)
        run('exact-current-artifact',['node',stage/'fetch-base.mjs','mac',outer],600,github)
        with zipfile.ZipFile(outer) as z:
            assert sorted(z.namelist())==['PACKAGE_READY.json','package.enc']
            assert z.getinfo('package.enc').file_size==991711977 and z.getinfo('PACKAGE_READY.json').file_size<16384
            manifest=work/'current.json'; manifest.write_bytes(z.read('PACKAGE_READY.json'))
            assert json.loads(manifest.read_bytes())['assets'][0]['plaintextSha256']=='f6a9ac5f8ce36d076d92d66fbc40b1cbcea33bb176818d2a1f5fe68b61a0fa15'
            cipher=work/'new.enc'
            with z.open('package.enc') as src,cipher.open('xb') as dst:shutil.copyfileobj(src,dst,1024**2)
        outer.unlink()
        run('authenticate-current',['node',transport,'decrypt','--manifest',manifest,'--id','pkg','--input',cipher,'--output',new],180,key)
        cipher.unlink()
        old_manifest=H/'RELEASED17_PACKAGE_TRANSPORT.json'
        asset=json.loads(old_manifest.read_bytes())['assets'][0]
        assert asset['url']=='https://github.com/Siiiiimon123/OMC-build-checks/releases/download/omc-mac-update17-build-41192102628/final.enc'
        budget(1156045943)
        run('authenticate-old',['node',transport,'fetch','--manifest',old_manifest,'--id','final','--output',old],900,key)
        assert old.stat().st_size==1156045943 and sha(old)=='6400fe0d915dc0cd68a727772d7e66f9c168ef0d558e706caf40a71e0f9b00cc'
        assert new.stat().st_size==991711977 and sha(new)==asset_current
        fixture=work/'fixture.jpg'
        run('synthetic-fixture',[sys.executable,H.parent/'mac-update17/make_fixture.py',fixture],30)
        run('actual-manual-overwrite',['node',H/'payload-upgrade.mjs','--execute','/Applications/OMC-Preview.app',old,new,fixture,work/'migration',asset_current],1200)
        migration=json.loads((work/'migration/RESULT.json').read_bytes())
        assert migration['status']=='PASS_REAL_RELEASED17_TO23_PAYLOAD_INSTALL_AND_PROJECT_KEEP_PRESERVATION'
        result.update(status='PASS_MAC17_TO23_ISOLATED_MANUAL_UPGRADE',migration=migration)
    except Exception as e:
        result['error']=type(e).__name__+': '+str(e)
        (evidence/'ERROR.log').write_text(traceback.format_exc(),encoding='utf8')
    finally:
        details=work/'migration/RESULT.json'
        if details.is_file():shutil.copyfile(details,evidence/'MIGRATION.json')
        (evidence/'SUMMARY.json').write_text(json.dumps(result,indent=2),encoding='utf8')
        report=work/'reports.zip'
        with zipfile.ZipFile(report,'x',zipfile.ZIP_DEFLATED) as z:
            for p in sorted(evidence.iterdir()):z.write(p,p.name)
        subprocess.run(['node',transport,'encrypt','--input',report,'--output',output/'reports.enc','--manifest',output/'REPORTS_READY.json','--id','reports'],check=True,env=key,timeout=60)
    return 0 if result['status'].startswith('PASS_') else 1
asset_current='f6a9ac5f8ce36d076d92d66fbc40b1cbcea33bb176818d2a1f5fe68b61a0fa15'
if __name__=='__main__':sys.exit(main())
