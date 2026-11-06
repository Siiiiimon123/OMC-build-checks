"""Bounded same-machine ORT microbenchmark; never a product acceptance result."""
from pathlib import Path
import gc,hashlib,json,os,platform,statistics,subprocess,sys,time

def digest(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def save(path,value):Path(path).write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')

def child(model,mode,out):
    import numpy as np
    import onnxruntime as ort
    assert ort.__version__=='1.19.2' and np.__version__=='2.5.2'
    assert platform.machine()=='arm64' and sys.platform=='darwin'
    options=ort.SessionOptions();options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    if mode.startswith('cpu-'):options.intra_op_num_threads=int(mode.split('-')[1])
    if mode=='coreml-3':options.intra_op_num_threads=3
    providers=[('CoreMLExecutionProvider',{'flags':'18'}),'CPUExecutionProvider'] if mode.startswith('coreml-') else ['CPUExecutionProvider']
    start=time.perf_counter();session=ort.InferenceSession(str(model),sess_options=options,providers=providers)
    initialize=(time.perf_counter()-start)*1000
    expected=providers[0][0] if isinstance(providers[0],tuple) else providers[0]
    assert session.get_providers()[0]==expected
    generator=np.random.default_rng(271828);inputs={}
    for item in session.get_inputs():
        shape=[1 if i==0 and not isinstance(x,int) else x for i,x in enumerate(item.shape)]
        assert item.type=='tensor(float)' and all(isinstance(x,int) and x>0 for x in shape),str(item.shape)
        assert np.prod(shape)<4*1024*1024
        inputs[item.name]=np.ascontiguousarray(generator.random(shape,dtype=np.float32))
    assert len(inputs)==1
    start=time.perf_counter();first=session.run(None,inputs);warmup=(time.perf_counter()-start)*1000
    timings=[];outputs=None
    for _ in range(12):
        start=time.perf_counter();outputs=session.run(None,inputs);timings.append((time.perf_counter()-start)*1000)
        assert all(np.isfinite(a).all() for a in outputs)
    flat=[a.astype(np.float64).ravel() for a in outputs]
    assert sum(a.size for a in flat)<100000
    save(out,{'modelSha256':digest(model),'mode':mode,'initializeMs':initialize,'warmupMs':warmup,
        'inputs':{k:{'shape':list(v.shape),'sha256':hashlib.sha256(v.tobytes()).hexdigest()} for k,v in inputs.items()},
        'providers':session.get_providers(),'measurementsMs':timings,'medianMs':statistics.median(timings),
        'outputs':[a.tolist() for a in flat],'outputShapes':[list(a.shape) for a in outputs],
        'ort':ort.__version__,'numpy':np.__version__,'threads':options.intra_op_num_threads})

def main(app,identity_file,out_dir):
    assert os.environ.get('GITHUB_ACTIONS')=='true' and platform.machine()=='arm64'
    root=Path(app);out=Path(out_dir);out.mkdir()
    identities=json.loads(Path(identity_file).read_bytes());results={}
    for entry in identities:
        matches=[p for p in root.rglob(entry['name']) if p.is_file() and not p.is_symlink() and digest(p)==entry['sha256']]
        assert matches,entry['name']+'_MISSING_OR_MISMATCH'
        model=next((p for p in matches if '_internal' in p.parts),matches[0])
        assert digest(model.with_name(entry['externalName']))==entry['externalSha256']
        rows=[]
        # Alternating which provider is first reduces a simple ordering confound.
        modes=['coreml-18','coreml-3','cpu-3'] if len(results)%2==0 else ['cpu-3','coreml-3','coreml-18']
        for mode in modes:
            destination=out/(entry['role']+'-'+mode+'.json')
            with (out/(entry['role']+'-'+mode+'.log')).open('xb') as log:
                subprocess.run([sys.executable,__file__,'child',str(model),mode,str(destination)],check=True,stdout=log,stderr=subprocess.STDOUT,timeout=180)
            rows.append(json.loads(destination.read_bytes()))
        reference=next(r for r in rows if r['mode']=='cpu-3')
        reference_outputs=reference['outputs']
        for row in rows:
            assert row['inputs']==reference['inputs'] and row['outputShapes']==reference['outputShapes']
            row['maxAbsoluteDifferenceFromCpu3']=max(abs(a-b) for a1,b1 in zip(row.pop('outputs'),reference_outputs) for a,b in zip(a1,b1))
        results[entry['role']]={'modelSha256':entry['sha256'],'externalSha256':entry['externalSha256'],'comparisons':rows}
        save(out/'PROVIDER_COMPARISON.json',{'status':'PARTIAL','roles':results})
    save(out/'PROVIDER_COMPARISON.json',{'status':'PASS_BOUNDED_MODEL_LATENCY_MEASUREMENT','roles':results,
        'machine':{'cpu':os.cpu_count(),'arch':platform.machine(),'macOS':platform.mac_ver()[0]},
        'limits':['Seeded synthetic tensors, batch1,12 warm serial measurements, one cloud VM',
            'Not full application throughput, camera-photo accuracy, physical Apple hardware or automatic provider selection qualification',
            'Uses same locked ORT/numpy versions in isolated probe; product runtime unchanged'],
        'productChanged':False,'packageRebuilt':False})

if __name__=='__main__':
    if sys.argv[1]=='child':child(Path(sys.argv[2]),sys.argv[3],sys.argv[4])
    else:main(*sys.argv[1:])
