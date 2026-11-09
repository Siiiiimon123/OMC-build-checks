import base64, os, subprocess
from pathlib import Path
from run24 import HERE, adapted, raw, read, save, sha, unzip, owned_remove, WORK, KEY

BRANCH = "refs/heads/verify-update24-delivery-delta"
assert os.environ["GITHUB_ACTIONS"] == "true" and os.environ["GITHUB_REPOSITORY"] == "Siiiiimon123/OMC-build-checks"
assert os.environ["GITHUB_REF"] == BRANCH and os.environ["GITHUB_RUN_ATTEMPT"] == "1"
WORK.mkdir()
transport = WORK / "transport.cjs"
transport.write_bytes(raw("final19/transport.cjs"))
assert sha(transport) == "19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f"
clean = {k:v for k,v in os.environ.items() if k not in (KEY, "GH_TOKEN", "GITHUB_TOKEN")}
def run(*args, env=clean):
    subprocess.run(list(map(str,args)), cwd=WORK, env=env, timeout=600, check=True)
def decrypt(label, manifest, source, out):
    run("node",transport,"decrypt","--id",label,"--manifest",manifest,"--input",source,"--output",out,
        env={**clean,KEY:os.environ[KEY]})
def get(name, spec):
    helpers = WORK / name
    helpers.mkdir()
    save(helpers/"BASE20_ARTIFACTS.json",{"windows":spec})
    adapter=helpers/"fetch.mjs"
    adapted("native23/fetch-base.mjs",adapter,[("refs/heads/verify-optimization20",BRANCH)])
    archive=WORK/(name+".zip")
    run("node",adapter,"windows",archive,env={**clean,"GH_TOKEN":os.environ["GH_TOKEN"]})
    folder=WORK/(name+"-zip")
    unzip(archive,folder,1100*1024**2)
    archive.unlink()
    assert {p.name for p in folder.iterdir()}=={"PACKAGE_READY.json","package.enc"}
    package=WORK/(name+".exe")
    decrypt("pkg",folder/"PACKAGE_READY.json",folder/"package.enc",package)
    owned_remove(folder)
    assert package.stat().st_size==spec["plainBytes"] and sha(package)==spec["plainSha256"]
    return package
base=get("base",read(HERE/"BASE20_ARTIFACTS.json")["windows"])
target=get("target",read(HERE/"WIN_EXISTING24.json")["installer"])
(WORK/"overlay.enc").write_bytes(base64.b64decode(raw("update24/overlay24.b64").strip(),validate=True))
overlay=WORK/"overlay.gz"
decrypt("update24-source",HERE/"OVERLAY.json",WORK/"overlay.enc",overlay)
patch=WORK/"patch.bin"
run("node",HERE/"make-delivery-delta24.cjs",base,target,overlay,patch)
assert patch.stat().st_size < 72 * 1024**2
out=WORK/"delta"
out.mkdir()
run("node",transport,"encrypt","--id","windows24-delivery","--input",patch,"--output",out/"patch.enc",
    "--manifest",out/"PATCH_READY.json",env={**clean,KEY:os.environ[KEY]})
