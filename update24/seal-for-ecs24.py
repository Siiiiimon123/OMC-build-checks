import os, subprocess
from pathlib import Path
from run24 import HERE, adapted, raw, read, save, sha, unzip, owned_remove, WORK, KEY

BRANCH="refs/heads/verify-update24-ecs-delivery"
assert os.environ["GITHUB_ACTIONS"]=="true" and os.environ["GITHUB_REPOSITORY"]=="Siiiiimon123/OMC-build-checks"
assert os.environ["GITHUB_REF"]==BRANCH and os.environ["GITHUB_RUN_ATTEMPT"]=="1"
WORK.mkdir()
transport=WORK/"transport.cjs"
transport.write_bytes(raw("final19/transport.cjs"))
assert sha(transport)=="19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f"
public={k:v for k,v in os.environ.items() if k not in (KEY,"GH_TOKEN","GITHUB_TOKEN")}
def run(args, env=public):
    subprocess.run(list(map(str,args)),cwd=WORK,env=env,check=True,timeout=600)
assets=read(HERE.parent/"delivery24/BASE20_ARTIFACTS.json")
for platform in ("windows","mac"):
    spec=assets[platform]
    out=WORK/platform
    out.mkdir()
    save(out/"BASE20_ARTIFACTS.json",{platform:spec})
    fetcher=out/"fetch.mjs"
    adapted("native23/fetch-base.mjs",fetcher,[("refs/heads/verify-optimization20",BRANCH)])
    archive=WORK/(platform+".zip")
    run(["node",fetcher,platform,archive],{**public,"GH_TOKEN":os.environ["GH_TOKEN"]})
    unpack=WORK/(platform+"-unpacked")
    unzip(archive,unpack,1100*1024**2)
    archive.unlink()
    assert {p.name for p in unpack.iterdir()}=={"PACKAGE_READY.json","package.enc"}
    package=WORK/(platform+".native")
    run(["node",transport,"decrypt","--id","pkg","--manifest",unpack/"PACKAGE_READY.json",
        "--input",unpack/"package.enc","--output",package],{**public,KEY:os.environ[KEY]})
    owned_remove(unpack)
    assert package.stat().st_size==spec["plainBytes"] and sha(package)==spec["plainSha256"]
    run(["node",HERE/"seal-for-ecs24.cjs","seal",WORK,platform,package])
    package.unlink()
    assert (out/"payload.enc").stat().st_size==spec["plainBytes"]
