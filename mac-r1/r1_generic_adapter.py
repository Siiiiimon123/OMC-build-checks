"""Generic, source-hash-bound R1 adapter; no network, model or product source."""
import ast

def adapt_bootstrap(value, manifest_sha256, expected_tree, expected_files):
    text=value.decode('utf-8').replace('\r\n','\n')
    tree=ast.parse(text)
    node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='apply_source_overrides')
    replacement='''def apply_source_overrides(source,root,base_safe):
    patch_root=Path(__file__).resolve().parent/'r1-delta'
    manifest_path=patch_root/'SOURCE_MANIFEST_MAC_R1.json'
    assert sha(manifest_path)==MANIFEST_SHA
    effective=read(manifest_path)
    assert effective['sourceTree']==EXPECTED_TREE
    records={r['path']:r for r in effective['records']}
    assert len(records)==len(effective['records'])==EXPECTED_FILES
    assert base_safe['sourceTree']=='fde850dd1be45aacdfa5ef440d705f3fb0aa0350'
    origins={r['path']:r for r in base_safe['records']}
    def safe_path(root,rel):
        p=PurePosixPath(rel)
        assert rel and not p.is_absolute() and '..'not in p.parts and chr(92)not in rel and ':'not in rel
        f=root.joinpath(*p.parts)
        assert not f.is_symlink() and f.resolve().is_relative_to(root.resolve())
        for parent in f.parents:
            if parent==root:break
            assert not parent.is_symlink()
        return f
    # Verify every previous source byte before replacing/removing any owned file.
    for rel,row in origins.items():
        f=safe_path(source,rel)
        assert f.is_file() and f.stat().st_size==row['bytes'] and sha(f)==row['sha256']
    for rel,row in records.items():
        payload=safe_path(patch_root/'source-r1',rel)
        assert payload.is_file() and payload.stat().st_size==row['bytes'] and sha(payload)==row['sha256']
    for rel in sorted(set(origins)-set(records)):
        safe_path(source,rel).unlink()
    for rel,row in records.items():
        dest=safe_path(source,rel);dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(safe_path(patch_root/'source-r1',rel),dest)
        os.chmod(dest,int(row['mode'],8)&0o777)
    output=root/'metadata/source-manifest.mac-r1.json';shutil.copyfile(manifest_path,output)
    return effective,output,{'schema':'omc-r1-native-source-overlay-v1','baseSafeSourceTree':base_safe['sourceTree'],
        'effectiveSourceTree':effective['sourceTree'],'windowsR1SourceTree':effective['windowsR1SourceTree'],
        'effectiveSourceManifestSHA256':sha(output),'sourceFiles':len(records),'macMetadataDerivedBeforeGitAndVite':True}
'''.replace('MANIFEST_SHA',repr(manifest_sha256)).replace('EXPECTED_TREE',repr(expected_tree)).replace('EXPECTED_FILES',str(expected_files))
    lines=text.splitlines(True);lines[node.lineno-1:node.end_lineno]=[replacement]
    text=''.join(lines).replace('1.0.21-preview.15','1.0.21-preview.18')
    marker="        run('audit-arm64-no-windows-payload'"
    assert text.count(marker)==1
    text=text.replace(marker,"        assert not list((app/'Contents/Resources/ai-service').rglob('approved-ai-runtime.json')), 'WINDOWS_APPROVED_RUNTIME_MUST_NOT_ENTER_MAC_PAYLOAD'\n"+marker)
    compile(text,'<derived-r1-native-bootstrap>','exec')
    return text.encode('utf-8')

def extract_r1_delta(archive, adapter, expected_sha256):
    import hashlib,stat,zipfile
    from pathlib import PurePosixPath
    assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected_sha256
    with zipfile.ZipFile(archive) as z:
        entries=z.infolist();assert 1<=len(entries)<=1024
        assert len({r.filename for r in entries})==len(entries)
        assert sum(r.file_size for r in entries)<=16*1024*1024
        for row in entries:
            assert row.orig_filename==row.filename and chr(92)not in row.orig_filename
            p=PurePosixPath(row.filename)
            assert p.parts[0]=='r1-delta' and not p.is_absolute() and '..'not in p.parts and chr(92)not in row.filename and ':'not in row.filename
            assert not row.is_dir() and not stat.S_ISLNK(row.external_attr>>16)
            dest=adapter.joinpath(*p.parts);assert dest.resolve().is_relative_to(adapter.resolve())
            dest.parent.mkdir(parents=True,exist_ok=True)
            with dest.open('xb') as out:out.write(z.read(row))
