"""Prepared generic Mac2 controller. No network/App/key access without --execute.
Only disposable exact public-repo branch/run-attempt1; Root owns all readiness/feed.
"""
import argparse, hashlib, json, os, platform, re, signal, subprocess, sys, tarfile, threading, time, urllib.parse, urllib.request, zipfile
from pathlib import Path, PurePosixPath
from publication_helpers import publish
REPO='Siiiiimon123/OMC-build-checks';WIN='7fd90440ad51eb7abdf3407b6a25f09ca49a8604';MAC='42a64bd6e221d12cad35f0bd8e7d85ee89237e6a';NATIVE='126976cbb5e25f01bc1763294ba6a75800bc5f99'
OLD_SHA='6400fe0d915dc0cd68a727772d7e66f9c168ef0d558e706caf40a71e0f9b00cc'
def sha(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,obj):Path(p).write_text(json.dumps(obj,indent=2)+'\n',encoding='utf-8')
def phase(p):print(json.dumps({'phase':p}),flush=True)
def safe_zip(archive,dest):
    with zipfile.ZipFile(archive) as z:
        entries=z.infolist();assert 1<=len(entries)<=1200 and len({x.filename for x in entries})==len(entries);assert sum(x.file_size for x in entries)<=16*1024*1024
        for row in entries:
            n=PurePosixPath(row.filename);assert n.parts[0]=='final' and not n.is_absolute() and '..' not in n.parts and '\\' not in row.filename and ':' not in row.filename and ((row.external_attr>>16)&0o170000)!=0o120000
            target=dest.joinpath(*n.parts)
            if row.is_dir():target.mkdir(parents=True,exist_ok=True);continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb') as out:out.write(z.read(row))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--config');parser.add_argument('--config-sha256');a=parser.parse_args()
    if not a.execute:print(json.dumps({'status':'PREPARED_DISABLED_NO_NETWORK_APP_OR_KEY','stages':['parallel released17 download','authenticate native72 PKG+source delta','frontend-only build','new18 install/JPEG DOM/fullAI/normal exit','early encrypted PKG+reports publication','real17->18 installer data preservation','<=15min QA_READY','controlled real update button+target+Installer','final encrypted reports'],'nativeExecutionVerified':False}));return
    assert sys.platform=='darwin' and platform.machine()=='arm64' and os.environ.get('GITHUB_ACTIONS')=='true'
    assert os.environ.get('GITHUB_REPOSITORY')==REPO and os.environ.get('GITHUB_REF')=='refs/heads/verify-mac-r1-18' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'
    assert sha(a.config)==a.config_sha256;cfg=json.loads(Path(a.config).read_bytes());assert cfg['executeAuthorized'] is True and cfg['rootReviewedController'] is True and cfg['macRunsUsedBeforeThis']==4 and cfg['maxMacRuns']==5 and cfg['maxSeconds']==3600 and cfg['feeUSD']==0 and cfg['sourceTreeWindows']==WIN and cfg['sourceTreeMac']==MAC and cfg['backendBuiltFromMacTree']==NATIVE
    assert os.environ.get('OMC_MAC_R1_AUTHORIZATION_ID')=='user-mac-last-20261103-1727' and cfg['completionAuthorizationId']=='user-mac-last-20261103-1727' and cfg['approvalTimestamp']=='2026-11-03T17:27:00+08:00' and cfg['approvedRunsThisAuthorization']==1
    assert cfg['additionalMacRunsApproved']==2 and cfg['additionalMacRunOrdinal']==2 and cfg['priorAdditionalMacSecondsCombined']==5400 and cfg['priorReservedAdditionalSecondsForManualSecondRun']==1800 and cfg['automaticRerun'] is False and cfg['stopOnSuccess'] is True
    here=Path(__file__).resolve().parent;tools=(here/cfg['genericToolsRelative']).resolve();assert tools.is_relative_to(here.parent.parent.resolve())
    route=cfg['qaRoute'];qa=urllib.parse.urlparse(route['qaMetadataPrefix']);assert route['formalMetadataPrefix']=='https://omc.xiaoa.cyou/updates/metadata/' and qa.scheme=='https' and qa.hostname=='omc.xiaoa.cyou' and qa.port in (None,443) and not qa.username and not qa.password and not qa.query and not qa.fragment and re.fullmatch(r'/updates/qa-r1/[A-Za-z0-9_-]{16,96}/',qa.path)
    assert cfg['readyUrl']==route['qaMetadataPrefix']+'QA_READY.json'
    assert sha(tools/'BASE_PACKAGE_TRANSPORT.json')==cfg['transportManifestSha256s']['base'] and sha(tools/'FINAL_DELTA_TRANSPORT.json')==cfg['transportManifestSha256s']['final']
    released17_manifest=tools/'RELEASED17_PACKAGE_TRANSPORT.json';assert sha(released17_manifest)==cfg['released17TransportManifestSha256']
    released17=json.loads(released17_manifest.read_bytes());assert released17['schema']=='omc-aes256gcm-build-transport-v1' and len(released17['assets'])==1
    baseline=released17['assets'][0];assert baseline['id']=='final' and baseline['plaintextBytes']==1156045943 and baseline['ciphertextBytes']==1156045943 and baseline['plaintextSha256']==OLD_SHA and baseline['ciphertextSha256']=='f9a686901717492c3fc053e9a9793dfe69d07e4f614c468e05be3811ce34f11c'
    assert baseline['url']=='https://github.com/Siiiiimon123/OMC-build-checks/releases/download/omc-mac-update17-build-41192102628/final.enc'
    work=Path(os.environ['RUNNER_TEMP'])/'omc-mac-final-handoff';work.mkdir(mode=0o700,exist_ok=False);reports=work/'reports';reports.mkdir();started=time.monotonic();deadline=started+cfg['maxSeconds']
    report={'status':'RUNNING','sourceTreeWindows':WIN,'sourceTreeMac':MAC,'backendBuiltFromMacTree':NATIVE,'controlledTransportRoute':True,'formalUrlServingTested':False,'automaticRerun':False,'steps':[],'forcedCleanup':[],'readinessWaitMaxSeconds':900};save(reports/'CONTROLLER.json',report)
    # Read existing transport/GitHub secrets only after every execution guard.
    key=os.environ.pop('OMC_PREVIEW15_TRANSPORT_KEY');token=os.environ.pop('GH_TOKEN');assert len(key)==64 and all(c in '0123456789abcdef' for c in key)
    clean=dict(os.environ);secret={**clean,'OMC_PREVIEW15_TRANSPORT_KEY':key};transport=tools/'transport.cjs';runid=os.environ['GITHUB_RUN_ID'];old_process=None
    def checkpoint():save(reports/'CONTROLLER.json',report)
    def census():
        text=subprocess.check_output(['/bin/ps','-axo','pid=,ppid=,lstart=,comm='],text=True,timeout=5);out={}
        for line in text.splitlines():
            p=line.strip().split()
            if len(p)>=8:out[int(p[0])]={'ppid':int(p[1]),'identity':' '.join(p[2:])}
        return out
    def run(label,args,seconds=900,env=None,cwd=None):
        phase(label);cap=min(seconds,max(1,int(deadline-time.monotonic()-240)));p=subprocess.Popen([str(x) for x in args],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env or clean,cwd=cwd,start_new_session=True);owned={};capture=reports/(label+'.log')
        def drain():
            with capture.open('wb') as f:
                remaining=262144
                while b:=p.stdout.read(8192):
                    if remaining:f.write(b[:remaining]);remaining=max(0,remaining-len(b))
        thread=threading.Thread(target=drain,daemon=True);thread.start();until=time.monotonic()+cap;failure=None
        try:
            while p.poll() is None:
                rows=census();ids={p.pid}
                for _ in range(16):ids.update(pid for pid,r in rows.items() if r['ppid'] in ids)
                owned.update({pid:rows[pid] for pid in ids if pid in rows})
                if time.monotonic()>=until:failure='BOUNDED_STEP_TIMEOUT';break
                time.sleep(.5)
        finally:
            current=census();survivors=[pid for pid,r in owned.items() if pid in current and current[pid]['identity']==r['identity']]
            if p.poll() is None or survivors:
                failure=failure or 'OWNED_PROCESS_REMAINED_AFTER_STEP'
                for sig in (signal.SIGTERM,signal.SIGKILL):
                    current=census()
                    for pid in survivors:
                        if pid in current and current[pid]['identity']==owned[pid]['identity']:
                            try:os.kill(pid,sig);report['forcedCleanup'].append({'pid':pid,'signal':sig.name,'label':label})
                            except ProcessLookupError:pass
                    if p.poll() is None:
                        try:os.killpg(p.pid,sig)
                        except ProcessLookupError:pass
                    time.sleep(1)
                try:p.wait(timeout=5)
                except subprocess.TimeoutExpired:failure='OWNED_TREE_DID_NOT_EXIT'
            thread.join(timeout=5)
        report['steps'].append({'label':label,'argv':[str(x) for x in args],'cwd':str(cwd) if cwd else None,'environmentKeys':sorted((env or clean).keys()),'exitCode':p.returncode,'failure':failure,'logCappedBytes':262144});checkpoint()
        if failure or p.returncode:raise RuntimeError(label+':'+str(failure or 'EXIT_NONZERO'))
    def report_tar(name):
        target=work/(name+'.tar');total=0
        with tarfile.open(target,'w') as t:
            for base,arc in [(reports,'controller'),(work/'frontend-stage/reports','build'),(work/'jpeg-dom-result','jpeg-dom'),(work/'payload-upgrade','payload-upgrade')]:
                if not base.exists():continue
                for f in sorted(base.rglob('*')):
                    if f.is_symlink() or not f.is_file() or any(x in ('profile','IndexedDB','blob_storage') for x in f.relative_to(base).parts):continue
                    if f.suffix.lower() not in ('.json','.log','.xml','.plist','.png','.txt'):continue
                    total+=f.stat().st_size
                    if total>8*1024*1024:raise RuntimeError('REPORT_TEXT_BUDGET_EXCEEDED')
                    t.add(f,arcname=arc+'/'+f.relative_to(base).as_posix(),recursive=False)
        return target
    def encrypt(file,id,name):
        cipher=work/(name+'.enc');manifest=work/(name+'.json');run('encrypt-'+name,['node',transport,'encrypt','--input',file,'--output',cipher,'--id',id,'--manifest',manifest],seconds=300,env=secret);return cipher,json.loads(manifest.read_bytes())['assets'][0]
    def publish_phase(kind,package=None):
        checkpoint();files=[];assets=[];tag='omc-mac-r1-final-'+kind+'-'+runid
        if package:
            encrypted,row=encrypt(package,'pkg','package');files.append(encrypted);row['url']='https://github.com/'+REPO+'/releases/download/'+tag+'/package.enc';assets.append(row)
        encrypted,row=encrypt(report_tar('reports-'+kind),'reports','reports-'+kind);files.append(encrypted);row['url']='https://github.com/'+REPO+'/releases/download/'+tag+'/'+encrypted.name;assets.append(row)
        output=work/('OUTPUTS_'+kind.upper()+'.json');save(output,{'schema':'omc-aes256gcm-build-transport-v1','assets':assets,'sourceTreeWindows':WIN,'sourceTreeMac':MAC,'backendBuiltFromMacTree':NATIVE,'runId':runid,'phase':kind,'status':report['status'],'controlledTransportRoute':True,'formalUrlServingTested':False,'earlyPackageReceipt':report.get('earlyPublication')});files.append(output)
        receipt=publish(token,files,tag);phase('encrypted-'+kind+'-published');return receipt
    try:
        # Reuse exact already-encrypted released17 from GitHub, in parallel. No server fallback.
        old_part=work/'released17.pkg.part'
        with (reports/'released17-transport.log').open('wb') as baseline_log:
            old_process=subprocess.Popen(['node',transport,'fetch','--manifest',released17_manifest,'--id','final','--output',old_part],stdout=baseline_log,stderr=subprocess.STDOUT,env=secret,start_new_session=True)
        run('fetch-native72',['node',transport,'fetch','--manifest',tools/'BASE_PACKAGE_TRANSPORT.json','--id','pkg','--output',work/'native72.pkg'],seconds=900,env=secret)
        run('fetch-small-final-source',['node',transport,'fetch','--manifest',tools/'FINAL_DELTA_TRANSPORT.json','--id','final','--output',work/'source.zip'],seconds=180,env=secret)
        assert sha(work/'source.zip')==cfg['privateZipSha256'];safe_zip(work/'source.zip',work);final=work/'final';source=final/'source';binding=json.loads((final/'COMPOSITE_BINDING.json').read_bytes());assert sha(final/'COMPOSITE_BINDING.json')==cfg['bindingSha256'];assert binding['frontendSourceTreeMac']==MAC and binding['backendBuiltFromMacTree']==NATIVE
        manifest=json.loads((final/'SOURCE_MANIFEST_MAC_FINAL.json').read_bytes())
        for row in manifest['records']:
            f=source/row['path'];assert f.stat().st_size==row['bytes'] and sha(f)==row['sha256'];os.chmod(f,int(row['mode'],8)&0o777)
        run('git-source-init',['git','init','--quiet',source])
        # Record the authenticated byte snapshot exactly. git add would apply
        # .gitattributes eol filters to three CRLF build inputs.
        subprocess.run(['git','read-tree','--empty'],cwd=source,env=clean,check=True,timeout=10)
        index_rows=[]
        for row in manifest['records']:
            raw=(source/row['path']).read_bytes()
            assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'],'SOURCE_CHANGED_BEFORE_RAW_GIT'
            expected_blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
            actual_blob=subprocess.check_output(['git','hash-object','--no-filters','-w','--stdin'],input=raw,cwd=source,env=clean,timeout=10).decode('ascii').strip()
            assert actual_blob==expected_blob,'RAW_GIT_BLOB_MISMATCH'
            assert '\n' not in row['path'] and '\0' not in row['path']
            index_rows.append((row['mode']+' '+actual_blob+'\t'+row['path']+'\0').encode('utf-8'))
        subprocess.run(['git','update-index','-z','--index-info'],input=b''.join(index_rows),cwd=source,env=clean,check=True,timeout=20)
        tree=subprocess.check_output(['git','write-tree'],cwd=source,env=clean,text=True,timeout=10).strip()
        report['actualRawSourceTreeMac']=tree;checkpoint()
        assert tree==MAC,'SOURCE_GIT_TREE_MISMATCH_EXPECTED_'+MAC+'_ACTUAL_'+tree
        run('git-source-record',['git','-c','user.name=OMC QA','-c','user.email=qa@invalid.local','commit','--quiet','-m','Authenticated exact Mac source'],cwd=source)
        approval=work/'NATIVE_STAGE_APPROVAL.json';save(approval,{'executeAuthorized':True,'frontendSourceTreeMac':MAC,'bindingSha256':cfg['bindingSha256']})
        run('reuse-native-build',[sys.executable,final/'harness/reuse-native-stage.py','--execute','--base-pkg',work/'native72.pkg','--source',source,'--binding',final/'COMPOSITE_BINDING.json','--manifest',final/'SOURCE_MANIFEST_MAC_FINAL.json','--tools',tools,'--work',work/'frontend-stage','--approval',approval],seconds=1500)
        built=json.loads((work/'frontend-stage/reports/COMPOSITE_BUILD_RESULT.json').read_bytes());package=Path(built['package']['path']);assert sha(package)==built['package']['sha256'];report['newPackage']=built['package'];report['newAsarSha256']=built['asarSha256'];report['packagingCommands']=built.get('packagingCommands',[]);checkpoint()
        # Disposable runner only: verified package readback and generated build App
        # yield to the one installed App; preserve receipts and the distinct PKG.
        import shutil
        reclaimed=[]
        for relative in ('frontend-stage/payload-readback','frontend-stage/OMC-Preview.app'):
            candidate=work/relative
            assert candidate.resolve().is_relative_to(work.resolve()) and not candidate.is_symlink() and candidate.is_dir()
            shutil.rmtree(candidate);reclaimed.append(relative)
        report['generatedPackageReadbackAndBuildAppReclaimedBeforeInstall']=reclaimed;checkpoint()
        run('install-new18',['sudo','-n','/usr/sbin/installer','-pkg',package,'-target','/'],seconds=300)
        installed_report=reports/'MAC_INSTALLED_APP_EVIDENCE.json'
        try:
            run('verify-installed-mac-app',['node',final/'harness/verify-installed-mac-app.cjs','/Applications/OMC-Preview.app',built['asarSha256'],installed_report],seconds=120,env={**clean,'NODE_PATH':str(source/'node_modules')})
        finally:
            if installed_report.is_file():
                report['macInstalledAppEvidence']=json.loads(installed_report.read_bytes())
            else:
                report['macInstalledAppEvidence']={'status':'FAIL','missingEvidence':['installed Resources inventory','installed app.asar SHA256','Info.plist bytes and SHA256','ElectronAsarIntegrity header comparison']}
            checkpoint()
        if report['macInstalledAppEvidence'].get('status')!='PASS':raise RuntimeError('INSTALLED_MAC_APP_EVIDENCE_FAILED')
        run('generate-native-fixtures',['node',final/'harness/generate-fixtures.mjs','--execute',work/'generated-jpeg'],seconds=120)
        run('new18-real-jpeg-dom',['node',final/'harness/jpeg-dom-final.mjs','--execute','/Applications/OMC-Preview.app',work/'generated-jpeg/FIXTURES.json',work/'jpeg-dom-result',source,final/'COMPOSITE_BINDING.json'],seconds=1000)
        fixture=work/'generated-jpeg/FRAME0000.JPG';run('new18-normal-full-ai',['node',final/'harness/normal-ai-regression.mjs','/Applications/OMC-Preview.app',reports/'NEW_NORMAL_AI.json',fixture],seconds=360)
        report['status']='PASS_NEW18_BUILD_UI_AI_AWAITING_UPGRADES';report['earlyPublication']=publish_phase('early',package);checkpoint();print(json.dumps({'phase':'early-package-ready','tag':report['earlyPublication']['tag'],'packageSha256':built['package']['sha256']}),flush=True)
        remaining=min(2700,max(1,int(deadline-time.monotonic()-900)));old_process.wait(timeout=remaining);assert old_process.returncode==0 and old_part.stat().st_size==1156045943 and sha(old_part)==OLD_SHA;old_pkg=work/'released17.pkg';old_part.rename(old_pkg)
        route=cfg['qaRoute'];ready=urllib.parse.urlparse(cfg['readyUrl']);assert ready.scheme=='https' and ready.hostname=='omc.xiaoa.cyou' and ready.port in (None,443) and cfg['readyUrl'].startswith(route['qaMetadataPrefix']) and not ready.username and not ready.password and not ready.query and not ready.fragment
        route_file=work/'QA_ROUTE.json';save(route_file,route);qa_env={**clean,'OMC_QA_ROUTE_FILE':str(route_file)}
        run('real17-to18-payload-data',['node',here/'payload-upgrade.mjs','--execute','/Applications/OMC-Preview.app',old_pkg,package,fixture,work/'payload-upgrade',built['package']['sha256']],seconds=900,env=qa_env)
        phase('await-root-qa-ready');until=min(time.monotonic()+900,deadline-600);ready_ok=False
        while time.monotonic()<until:
            try:
                with urllib.request.urlopen(cfg['readyUrl'],timeout=20) as r:
                    assert r.url==cfg['readyUrl'];body=r.read(16385);assert len(body)<=16384;value=json.loads(body)
                if value.get('ready') is True and value.get('sourceTreeMac')==MAC and value.get('packageSha256')==built['package']['sha256']:ready_ok=True;break
            except (OSError,ValueError):pass
            time.sleep(10)
        if not ready_ok:raise RuntimeError('QA_READY_NOT_BOUND_WITHIN_15_MINUTES')
        run('reinstall-real17-for-button',['sudo','-n','/usr/sbin/installer','-pkg',old_pkg,'-target','/'],seconds=300)
        run('controlled-update-button',['node',here/'controlled-upgrade-17-to-18.mjs','/Applications/OMC-Preview.app',fixture,reports/'CONTROLLED_TUF_UPGRADE.json',built['package']['sha256']],seconds=min(4200,max(1,int(deadline-time.monotonic()-300))),env=qa_env)
        actual=json.loads((reports/'CONTROLLED_TUF_UPGRADE.json').read_bytes());assert actual['status']=='PASS_ACTUAL_SIGNED_DOWNLOAD_OS_HANDOFF_INSTALL_REOPEN_AND_PROJECT_PRESERVATION' and actual['controlledTransportRoute'] is True and actual['formalUrlServingTested'] is False
        assert sha('/Applications/OMC-Preview.app/Contents/Resources/app.asar')==built['asarSha256'];assert not report['forcedCleanup'];report['status']='PASS_NATIVE_BUILD_UI_PAYLOAD_AND_CONTROLLED_TUF_UPGRADE_FORMAL_FEED_NOT_PROMOTED'
    except Exception as error:
        report['status']='FAIL_OR_HOLD';report['failureCategory']=type(error).__name__;report['failureCode']=(str(error).splitlines() or [type(error).__name__])[0][:240]
    finally:
        if old_process and old_process.poll() is None:
            try:os.killpg(old_process.pid,signal.SIGTERM);old_process.wait(timeout=5)
            except (ProcessLookupError,subprocess.TimeoutExpired):
                try:os.killpg(old_process.pid,signal.SIGKILL);old_process.wait(timeout=5)
                except (ProcessLookupError,subprocess.TimeoutExpired):report['oldDownloadDidNotReap']=True
        report['elapsedSeconds']=round(time.monotonic()-started,3);checkpoint()
        try:report['finalPublication']=publish_phase('result');checkpoint()
        except Exception as error:report['finalPublicationFailed']=type(error).__name__;report['status']='FAIL_FINAL_EVIDENCE_PUBLISH';checkpoint()
        print(json.dumps({'phase':'finished','status':report['status'],'elapsedSeconds':report['elapsedSeconds']}),flush=True)
    if not report['status'].startswith('PASS_NATIVE_BUILD_UI_PAYLOAD_AND_CONTROLLED'):raise SystemExit(1)
if __name__=='__main__':main()
