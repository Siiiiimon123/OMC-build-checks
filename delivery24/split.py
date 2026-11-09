"""Repackage existing authenticated ciphertext for the connector's512MiB limit."""
from pathlib import Path
import hashlib,json,os,subprocess,zipfile
HERE=Path(__file__).resolve().parent
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
assert os.environ.get('GITHUB_REF')=='refs/heads/verify-update24-delivery' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
root=Path(os.environ['RUNNER_TEMP'])/'omc-delivery24-parts';assert not root.exists();root.mkdir()
inputs=json.loads((HERE/'BASE20_ARTIFACTS.json').read_bytes())
for mode in ('windows','mac'):
    record=inputs[mode];folder=root/mode;folder.mkdir();archive=folder/'original.zip';out=folder/'parts';out.mkdir()
    subprocess.run(['node',HERE/'fetch-base.mjs',mode,archive],check=True,timeout=600)
    assert archive.stat().st_size==record['bytes']
    with archive.open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==record['sha256']
    parts=[];total=0;cipherhash=hashlib.sha256()
    with zipfile.ZipFile(archive) as z:
        assert sorted(z.namelist())==['PACKAGE_READY.json','package.enc'] and z.getinfo('PACKAGE_READY.json').file_size<16384
        meta=z.read('PACKAGE_READY.json');manifest=json.loads(meta)
        assert manifest['schema']=='omc-aes256gcm-build-transport-v1' and len(manifest['assets'])==1
        asset=manifest['assets'][0]
        assert asset['id']=='pkg' and asset['plaintextBytes']==record['plainBytes'] and asset['plaintextSha256']==record['plainSha256']
        assert asset['ciphertextBytes']==record['plainBytes'] and z.getinfo('package.enc').file_size==record['plainBytes']
        with z.open('package.enc') as stream:
            for index in range((record['plainBytes']+450*1024**2-1)//(450*1024**2)):
                target=out/('part%03d.enc'%index);count=0;h=hashlib.sha256()
                with target.open('xb') as f:
                    while count<450*1024**2:
                        block=stream.read(min(1024**2,450*1024**2-count))
                        if not block:break
                        f.write(block);count+=len(block);total+=len(block);h.update(block);cipherhash.update(block)
                assert count>0;parts.append({'name':target.name,'bytes':count,'sha256':h.hexdigest()})
            assert not stream.read(1)
        assert total==asset['ciphertextBytes'] and cipherhash.hexdigest()==asset['ciphertextSha256']
    (out/'PACKAGE_READY.json').write_bytes(meta)
    (out/'DELIVERY_PARTS.json').write_text(json.dumps({'schema':'omc-exact-ciphertext-delivery-parts-v1',
        'platform':mode,'sourceTree':record['sourceTree'],'originalArtifact':record['id'],
        'originalArchiveSha256':record['sha256'],'productChanged':False,'decrypted':False,
        'parts':parts,'asset':asset},indent=2)+'\n')
    archive.unlink()
    print(json.dumps({'platform':mode,'status':'PASS_SAME_CIPHERTEXT_SPLIT_FOR_DELIVERY','parts':parts,'productChanged':False,'decrypted':False}),flush=True)
