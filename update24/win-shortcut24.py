"""Close only the Windows desktop-launch gate on the already tested package."""
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import traceback
import zipfile

from run24 import HERE, REPO, WORK, KEY, VERSION, adapted, footprint, raw, read, save, sha, unzip


BRANCH = "refs/heads/verify-update24-win-shortcut"
SOURCE = "f4ad5908c20c001c49304675e6d669c55a2835e4"
BUILD_PROOF = "6d5f3540d0e27e57c89423536bb3bf0cc774e528"
TRANSFER_PROOF = "b423ee8c3622cd22ca1a260f62826f6d09270865"
TRANSFER = {
    "id": 13659084378,
    "bytes": 104196,
    "sha256": "fc58f215527f7992c777d107b5cc2eeb3863969bbb8ba6241a61880eeb3b8cb8",
}


def main():
    assert os.name == "nt" and os.environ.get("GITHUB_ACTIONS") == "true"
    assert os.environ.get("GITHUB_REPOSITORY") == "Siiiiimon123/OMC-build-checks"
    assert os.environ.get("GITHUB_REF") == BRANCH and os.environ.get("GITHUB_RUN_ATTEMPT") == "1"
    WORK.mkdir()
    evidence = WORK / "evidence"
    encrypted = WORK / "encrypted"
    controls = WORK / "controls"
    for folder in (evidence, encrypted, controls):
        folder.mkdir()
    transport = controls / "transport.cjs"
    transport.write_bytes(raw("final19/transport.cjs"))
    assert sha(transport) == "19f37e9f504c90cd26dc7ca9da8606af9a13154e2a9ec6f0fdd20e026d4ff90f"
    env = {k: v for k, v in os.environ.items()
           if k not in (KEY, "GH_TOKEN", "GITHUB_TOKEN") and k.lower() != "psmodulepath"}
    private = {**env, KEY: os.environ[KEY]}
    assets = read(HERE / "WIN_EXISTING24.json")
    exact = assets["installer"]
    summary = {
        "status": "RUNNING",
        "sourceTree": SOURCE,
        "controlCommit": os.environ["GITHUB_SHA"],
        "version": VERSION,
        "installerSha256": exact["plainSha256"],
        "installerBytes": exact["plainBytes"],
        "originalCandidateArtifact": exact["id"],
        "repeatedTransferTests": False,
        "productionEndpointUsed": False,
        "productRebuilt": False,
    }

    def run(name, args, variables=env, limit=600):
        print(json.dumps({"phase": name}), flush=True)
        with (evidence / (name + ".log")).open("xb") as log:
            subprocess.run(list(map(str, args)), cwd=WORK, env=variables, timeout=limit,
                           stdout=log, stderr=subprocess.STDOUT, check=True)

    def decrypt(name, key_id, manifest, cipher, output):
        run(name, ["node", transport, "decrypt", "--manifest", manifest, "--id", key_id,
                   "--input", cipher, "--output", output], private)

    def fetch_asset(label, asset, required, limit):
        folder = WORK / label
        target = controls / label
        target.mkdir()
        save(target / "BASE20_ARTIFACTS.json", {"windows": asset})
        adapter = target / "fetch-base.mjs"
        adapted("native23/fetch-base.mjs", adapter, [("refs/heads/verify-optimization20", BRANCH)])
        archive = WORK / (label + ".zip")
        run("fetch-" + label, ["node", adapter, "windows", archive],
            {**env, "GH_TOKEN": os.environ["GH_TOKEN"]})
        assert archive.stat().st_size == asset["bytes"] and sha(archive) == asset["sha256"]
        unzip(archive, folder, limit)
        assert {p.name for p in folder.iterdir()} == set(required)
        archive.unlink()
        return folder

    def fetch_proof(label, asset, control):
        folder = fetch_asset(label, asset, ["REPORTS_READY.json", "reports.enc"], 2 * 1024**2)
        archive = WORK / (label + "-authenticated.zip")
        decrypt("decrypt-" + label, "reports", folder / "REPORTS_READY.json",
                folder / "reports.enc", archive)
        out = WORK / (label + "-authenticated")
        unzip(archive, out, 16 * 1024**2)
        receipt = read(out / "SUMMARY.json")
        assert receipt["sourceTree"] == SOURCE and receipt["controlCommit"] == control
        assert receipt.get("installerSha256", receipt.get("builtInstallerSha256")) == exact["plainSha256"]
        return out, receipt

    try:
        _, transfer = fetch_proof("transfer-proof", TRANSFER, TRANSFER_PROOF)
        assert transfer["nativeInstallation"] and transfer["transferPathsPassed"]
        summary.update(transferProofArtifact=TRANSFER["id"], transportPathsPassed=True)
        build_reports, _ = fetch_proof("build-proof", assets["evidence"], BUILD_PROOF)
        receipt = read(build_reports / "builder-PACKAGE_INPUTS.json")
        assert receipt["current"]["sha256"] == exact["plainSha256"]
        assert receipt["current"]["version"] == VERSION

        source = REPO / "native23"
        (WORK / "helpers.enc").write_bytes(base64.b64decode(raw("native23/helpers.b64").strip(), validate=True))
        helpers = WORK / "helpers.zip"
        decrypt("decrypt-verified-native-helpers", "native23-helpers", source / "HELPERS.transport.json",
                WORK / "helpers.enc", helpers)
        inputs = WORK / "inputs"
        unzip(helpers, inputs, 2 * 1024**2)
        shutil.copyfile(build_reports / "builder-FINAL_APP_MEMBERS.json", inputs / "FINAL_APP_MEMBERS.json")
        asset = fetch_asset("accepted-candidate", exact, ["PACKAGE_READY.json", "package.enc"], 1100 * 1024**2)
        package = WORK / "OMC-Preview-1.0.21-preview.24-x64.exe"
        decrypt("decrypt-exact-candidate", "pkg", asset / "PACKAGE_READY.json", asset / "package.enc", package)
        assert package.stat().st_size == exact["plainBytes"] and sha(package) == exact["plainSha256"]
        (asset / "package.enc").unlink()
        receipt["current"]["path"] = str(package)
        save(inputs / "PACKAGE_INPUTS.json", receipt)

        old = (inputs / "Install-FinalWindows.ps1").read_text(encoding="utf-8-sig")
        assert old.count("refs/heads/verify-optimization20") == 1
        installer = inputs / "Install-ShortcutOnly.ps1"
        installer.write_text(old.replace("refs/heads/verify-optimization20", BRANCH),
                             encoding="utf-8-sig", newline="\r\n")
        run("native-exact-first-install", ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", installer, "-InputsPath", inputs / "PACKAGE_INPUTS.json",
            "-OutputPath", evidence / "FIRST_INSTALL.json"])
        info = read(evidence / "FIRST_INSTALL.json")
        assert info["installedPayloadPassed"] and info["verifiedPayloadFiles"] == 2609
        installed = Path(info["executable"]).parent
        assert sha(installed / "resources/app.asar") == transfer["installedAsarSha256"]
        measured = footprint([WORK, installed])
        save(evidence / "SPACE.json", {"bytes": measured, "limit": 5 * 1024**3})
        assert measured < 5 * 1024**3
        summary["nativeInstallation"] = True

        verifier = controls / "cloud-shortcut-launch.mjs"
        adapted("native23/cloud-shortcut-launch.mjs", verifier, [("refs/heads/verify-optimization20", BRANCH)])
        run("original-desktop-shortcut-launch", ["node", verifier, evidence / "FIRST_INSTALL.json",
            WORK / "shortcut", evidence], limit=300)
        proof = read(evidence / "ACTUAL_DESKTOP_SHORTCUT_LAUNCH.json")
        assert proof["status"] == "PASS_ACTUAL_UNICODE_DESKTOP_SHORTCUT_LAUNCH_AND_NATIVE_LINK_READ"
        assert proof["normalExitVerified"] and proof["nativeTargetAndIconVerifiedOnIdenticalBytes"]
        assert proof["originalShortcutUnchanged"]
        summary.update(status="PASS_NATIVE_PACKAGE_AND_ALL_TRANSFER_PATHS",
                       shortcutBindingPassed=True, installedAsarSha256=transfer["installedAsarSha256"])
    except Exception:
        summary["status"] = "FAIL"
        (evidence / "ERROR.txt").write_text(traceback.format_exc(), encoding="utf-8")
    finally:
        save(evidence / "SUMMARY.json", summary)
        archive = WORK / "reports.zip"
        with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as output:
            for p in sorted(evidence.iterdir()):
                if p.is_file():
                    output.write(p, p.name)
        run("encrypt-reports", ["node", transport, "encrypt", "--input", archive,
            "--output", encrypted / "reports.enc", "--manifest", encrypted / "REPORTS_READY.json",
            "--id", "reports"], private)
    return 0 if summary["status"].startswith("PASS_") else 1


if __name__ == "__main__":
    raise SystemExit(main())
