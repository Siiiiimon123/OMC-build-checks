// Cloud-only diagnostic observation. Preserve constructor brands and native calls.
(() => {
  const OriginalError=window.Error, OriginalAbortController=window.AbortController;
  const state={errors:[],aborts:[],clicks:[],responses:[],instrumented:true};
  const clean=value=>String(value??'').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,6000);
  const keep=(list,value,max)=>{list.push(value);if(list.length>max)list.shift();};
  window.__omcFailureObserver=state;
  const ObservedError=function Error(...args){
    const error=Reflect.construct(OriginalError,args,new.target||OriginalError);
    keep(state.errors,{at:performance.now(),message:clean(error.message),stack:clean(error.stack)},512);
    return error;
  };
  Object.setPrototypeOf(ObservedError,OriginalError);
  ObservedError.prototype=OriginalError.prototype;
  window.Error=ObservedError;
  class ConstructorProbe extends window.Error{}
  if(!(window.Error('diagnostic-constructor-probe') instanceof OriginalError)
      ||!(new ConstructorProbe('diagnostic-subclass-probe') instanceof ConstructorProbe)
      ||!(new TypeError('diagnostic-native-brand-probe') instanceof window.Error)){
    window.Error=OriginalError;throw new OriginalError('DIAGNOSTIC_CONSTRUCTOR_BRAND_CHECK');
  }
  const created=new WeakMap();
  window.AbortController=class AbortController extends OriginalAbortController{
    static [Symbol.hasInstance](value){return value instanceof OriginalAbortController;}
    constructor(...args){super(...args);created.set(this,clean(new OriginalError('controller-created').stack));}
    abort(reason){keep(state.aborts,{at:performance.now(),reason:clean(reason?.message??reason),reasonCode:clean(reason?.code),cause:clean(reason?.cause?.message),causeCode:clean(reason?.cause?.code),nestedCause:clean(reason?.cause?.cause?.message),stack:clean(new OriginalError('abort-observed').stack),created:created.get(this)},128);return super.abort(reason);}
  };
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
    const response=await nativeFetch(...args);
    const url=String(args[0]?.url??args[0]);
    if(/\/analyze\/(photo|batch)(?:$|\?)/.test(url)&&state.responses.length<32){
      const cloned=response.clone(),body=args[1]?.body;
      const request={};for(const key of ['photo_id','photo_ids','asset_id','asset_ids','analysis_generation','analysis_run_id','cache_namespace','cache_namespaces'])if(body?.get)request[key]=body.get(key);
      void(async()=>{const responseText=await cloned.text();let value;try{value=JSON.parse(responseText);}catch(error){keep(state.responses,{at:performance.now(),status:response.status,request,jsonParseError:clean(error?.message),rawPrefix:responseText.slice(0,3000),rawSuffix:responseText.slice(-1000)},32);return;}const hashes=[];for(const image of body?.getAll?.(body.has('images')?'images':'image')??[]){if(typeof image?.arrayBuffer==='function'){const digest=await crypto.subtle.digest('SHA-256',await image.arrayBuffer());hashes.push([...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''));}}keep(state.responses,{at:performance.now(),path:url.replace(/^.*(?=\/analyze\/)/,''),status:response.status,request,inputSha256:hashes,value},32);})().catch(error=>keep(state.responses,{error:clean(error?.message)},32));
    }
    return response;
  };
  document.addEventListener('click',event=>{const button=event.target?.closest?.('button');if(button)keep(state.clicks,{at:performance.now(),label:clean(button.getAttribute('aria-label')??button.innerText)},32);},true);
  return true;
})()
