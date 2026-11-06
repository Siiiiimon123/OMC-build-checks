// Cloud-only diagnostic observation. Preserve constructor brands and native calls.
(() => {
  const OriginalError=window.Error, OriginalAbortController=window.AbortController;
  const state={errors:[],aborts:[],clicks:[],instrumented:true};
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
    abort(reason){keep(state.aborts,{at:performance.now(),reason:clean(reason?.message??reason),stack:clean(new OriginalError('abort-observed').stack),created:created.get(this)},128);return super.abort(reason);}
  };
  document.addEventListener('click',event=>{const button=event.target?.closest?.('button');if(button)keep(state.clicks,{at:performance.now(),label:clean(button.getAttribute('aria-label')??button.innerText)},32);},true);
  return true;
})()
