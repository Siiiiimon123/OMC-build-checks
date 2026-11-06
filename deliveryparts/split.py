"""Transfer only immutable existing ciphertext, no product execution or keys."""
from pathlib import Path
import hashlib,json,os,subprocess,zipfile
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Siiiiimon123/OMC-build-checks'
assert os.environ.get('GITHUB_REF')=='refs/heads/verify-optimization20' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
root=Path(os.environ['RUNNER_TEMP'])/'omc-delivery-parts21'
assert not root.exists()
root.mkdir();archive=root/'original.zip';out=root/'parts';out.mkdir()
subprocess.run(['node','final21/fetch-frozen21.mjs','windows',str(archive)],check=True,timeout=600)
assert archive.stat().st_size==806703885
with archive.open('rb') as f:
    assert hashlib.file_digest(f,'sha256').hexdigest()=='1c81315b819836b0de29112a08ee95b1e7ec94735817b86d844e651b89722258'
parts=[];total=0;cipherhash=hashlib.sha256()
with zipfile.ZipFile(archive) as z:
    assert sorted(z.namelist())==['PACKAGE_READY.json','package.enc']
    assert z.getinfo('PACKAGE_READY.json').file_size<16384
    meta=z.read('PACKAGE_READY.json');m=json.loads(meta)
    assert m['schema']=='omc-aes256gcm-build-transport-v1' and len(m['assets'])==1
    asset=m['assets'][0]
    assert asset['id']=='pkg' and asset['plaintextBytes']==806457221
    assert asset['plaintextSha256']=='9dc4195d811683ae66c8b3ca452b16e5d47b0b3c045eda339bc01817e0096a3a'
    assert asset['ciphertextBytes']==806457221 and z.getinfo('package.enc').file_size==806457221
    with z.open('package.enc') as stream:
        for index in range(2):
            target=out/('part%03d.enc'%index);count=0;h=hashlib.sha256()
            with target.open('xb') as f:
                while count<450*1024**2:
                    block=stream.read(min(1024**2,450*1024**2-count))
                    if not block:break
                    f.write(block);count+=len(block);total+=len(block);h.update(block);cipherhash.update(block)
            assert count>0
            parts.append({'name':target.name,'bytes':count,'sha256':h.hexdigest()})
        assert not stream.read(1)
    assert total==asset['ciphertextBytes'] and cipherhash.hexdigest()==asset['ciphertextSha256']
(out/'PACKAGE_READY.json').write_bytes(meta)
(out/'DELIVERY_PARTS.json').write_text(json.dumps({'schema':'omc-exact-ciphertext-delivery-parts-v1','platform':'windows','sourceTree':'883787ae0ea60c56d348ff758fa150fb3f40007d','originalArtifact':13523823651,'originalArchiveSha256':'1c81315b819836b0de29112a08ee95b1e7ec94735817b86d844e651b89722258','productChanged':False,'decrypted':False,'parts':parts,'asset':asset},indent=2)+'\n')
archive.unlink()
print(json.dumps({'status':'PASS_SAME_CIPHERTEXT_SPLIT_FOR_DELIVERY','parts':parts,'decrypted':False,'productChanged':False}))
