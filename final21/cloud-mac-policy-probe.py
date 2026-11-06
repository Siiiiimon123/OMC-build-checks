"""Exercise frozen candidate AST with real ORT/models, not installed-app acceptance."""
from pathlib import Path
import ast,contextlib,hashlib,json,os,platform,statistics,sys,time
import numpy as np
import onnxruntime as ort

source,app,identities,out_dir=map(Path,sys.argv[1:])
assert os.environ.get('GITHUB_ACTIONS')=='true' and sys.platform=='darwin'
assert ort.__version__=='1.19.2' and np.__version__=='2.5.2'
out_dir.mkdir()
names={'_create_session_options','_fixed_session_inputs','_probe_outputs_match',
       '_mac_probe_prefers_cpu','_probe_mac_cpu_preference'}
nodes=[n for n in ast.parse(source.read_text(encoding='utf8')).body if isinstance(n,ast.FunctionDef) and n.name in names]
assert {n.name for n in nodes}==names
space={'sys':sys,'os':os,'np':np,'time':time,'ort':ort,'CPU_PROVIDER':'CPUExecutionProvider',
    'DIRECTML_PROVIDER':'DmlExecutionProvider','DML_PROBE_ATOL':1e-3,'DML_PROBE_RTOL':1e-3,
    'runtime_generation_is_current':lambda _:True,
    'ort_session_evidence_lock':contextlib.nullcontext(),'ort_session_evidence_bindings':{}}
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),space)
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
files={}
for row in json.loads(identities.read_bytes()):
    matches=[p for p in app.rglob(row['name']) if p.is_file() and not p.is_symlink() and sha(p)==row['sha256']]
    assert matches,row['role']
    model=next((p for p in matches if '_internal' in p.parts),matches[0])
    assert sha(model.with_name(row['externalName']))==row['externalSha256']
    files[{'vision':'vision','technical':'waste_filter','reference':'quality_reference'}[row['role']]]=model
def factory(model,provider,adapter_device_id=None,profile_role=None,evidence_context=None,cpu_thread_count=None):
    # Source options are real; lifecycle/profile plumbing is explicitly adapted
    # for this isolated component probe and is not an installed-service receipt.
    options=space['_create_session_options'](provider,cpu_thread_count=cpu_thread_count)
    chain=[('CoreMLExecutionProvider',{'flags':'18'}),'CPUExecutionProvider'] if provider=='CoreMLExecutionProvider' else [provider]
    session=ort.InferenceSession(str(model),sess_options=options,providers=chain)
    assert session.get_providers()[0]==provider
    space['ort_session_evidence_bindings'][id(session)]={'probeOnly':True}
    return session
accelerated={k:factory(p,'CoreMLExecutionProvider') for k,p in files.items()}
for session in accelerated.values():session.run(None,space['_fixed_session_inputs'](session))
space.update(_create_ort_session=factory,_finish_session_profile=lambda *a,**kw:{},
    _run_lifecycle_ort_session=lambda s,x,*a:s.run(None,x),
    CLIP_VISION_ONNX=files['vision'],WASTE_FILTER_ONNX=files['waste_filter'],
    QUALITY_REFERENCE_MODEL_DIR=files['quality_reference'].parent,
    verify_topiq_files=lambda _:files['quality_reference'],
    clip_vision_session=accelerated['vision'],waste_filter_technical_session=accelerated['waste_filter'],
    quality_reference_session=accelerated['quality_reference'])
decision=space['_probe_mac_cpu_preference'](1)
assert decision['status']=='measured' and len(decision['rows'])==3
rows=[]
for role,path in files.items():
    selected=factory(path,'CPUExecutionProvider',cpu_thread_count=decision['cpu_thread_count']) if decision['select_cpu'] else accelerated[role]
    timings={'selected':[],'current':[]};difference=0.
    for seed in range(5):
        rng=np.random.default_rng(41+seed)
        inputs={k:rng.random(v.shape,dtype=np.float32) for k,v in space['_fixed_session_inputs'](selected).items()}
        values={}
        for label,session in [('current',accelerated[role]),('selected',selected)]:
            start=time.perf_counter();values[label]=session.run(None,inputs);timings[label].append((time.perf_counter()-start)*1000)
        assert space['_probe_outputs_match'](values['current'],values['selected'])
        difference=max(difference,max(float(np.max(np.abs(a-b))) for a,b in zip(values['current'],values['selected'])))
    rows.append({'role':role,'maxAbsoluteOutputDifference':difference,
        'currentMedianMs':statistics.median(timings['current']),'selectedMedianMs':statistics.median(timings['selected'])})
result={'status':'PASS_SOURCE_MAC_POLICY_WITH_REAL_MODELS','sourceSha256':sha(source),'decision':decision,'comparisons':rows,
    'machine':{'cores':os.cpu_count(),'arch':platform.machine()},'installedAppCandidateTested':False,
    'limits':['Actual frozen source functions and exact models; lifecycle adapter and isolated locked Python runtime',
        'Five seeded synthetic tensors,not image accuracy or installed full-service/thousand throughput',
        'No installer built, no provider forced, no production publication']}
(out_dir/'MAC_SOURCE_POLICY.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
