"""Adapt only the external test harness to the frozen automatic-preview UI."""
ORIGIN_UI_SHA = 'dc5f18b214824dd60350ea6b099abbad7ba6a67e9082a162542fa0534765e519'


def adapt_ui(source):
    import hashlib
    assert hashlib.sha256(source).hexdigest() == ORIGIN_UI_SHA
    text = source.decode('utf-8').replace('\r\n', '\n')
    old = "async function save(){await client.click('生成 RAW 预览');await rawReady();"
    assert text.count(old) == 1
    text = text.replace(old, 'async function save(){await rawReady();')
    cancel = "await slider('RAW 曝光 EV',.7);await client.click('生成 RAW 预览');"
    assert text.count(cancel) == 1
    text = text.replace(cancel, "await slider('RAW 曝光 EV',.7);")
    assert text.count("client.click('生成 RAW 预览')") == 1
    return text.replace("client.click('生成 RAW 预览')", "client.click('刷新 RAW 预览')").encode('utf-8')


def patch_native_hook(text):
    # All files are small test scripts outside the product source tree.
    old = "native_code=run('native-synthetic-raw-lifecycle',[py,tools/'mac_native_acceptance.py',"
    assert text.count(old) == 1 and text.count('def main():') == 1
    helper = '''def prepare_current_native_ui_tools(tools,work,reports):
    ui_tools=work/'derived-native-ui-tools'
    assert not ui_tools.exists()
    ui_tools.mkdir()
    records=[]
    for name in ['mac_native_acceptance.py','mac_native_ui.mjs','mac_cdp_app.mjs','mac_inputs.py']:
        origin=tools/name
        assert origin.is_file() and not origin.is_symlink()
        shutil.copyfile(origin,ui_tools/name)
        records.append({'path':name,'originSha256':sha(origin)})
    target=ui_tools/'mac_native_ui.mjs'
    assert sha(target)=='dc5f18b214824dd60350ea6b099abbad7ba6a67e9082a162542fa0534765e519'
    value=target.read_text(encoding='utf-8')
    before="async function save(){await client.click('生成 RAW 预览');await rawReady();"
    assert value.count(before)==1
    value=value.replace(before,'async function save(){await rawReady();')
    cancel="await slider('RAW 曝光 EV',.7);await client.click('生成 RAW 预览');"
    assert value.count(cancel)==1
    value=value.replace(cancel,"await slider('RAW 曝光 EV',.7);")
    assert value.count("client.click('生成 RAW 预览')")==1
    value=value.replace("client.click('生成 RAW 预览')","client.click('刷新 RAW 预览')")
    target.write_text(value,encoding='utf-8',newline='\\n')
    save(reports/'NATIVE_UI_CONTRACT_ADAPTER.json',{'originUI':records[1]['originSha256'],'derivedUI':sha(target),'files':records,'scope':'external test only; wait for actual automatic preview before save, current refresh control for real cancel/retry','appSourceChanged':False})
    return ui_tools


'''
    text = text.replace('def main():', helper + 'def main():', 1)
    return text.replace(old, "ui_tools=prepare_current_native_ui_tools(tools,work,reports)\n        native_code=run('native-synthetic-raw-lifecycle',[py,ui_tools/'mac_native_acceptance.py',", 1)
