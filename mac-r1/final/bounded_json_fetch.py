"""Read a small HTTP JSON response in a killable child under a monotonic deadline."""
import argparse,base64,json,subprocess,sys,time,urllib.error,urllib.parse,urllib.request
if not __debug__:raise RuntimeError('PYTHON_OPTIMIZATION_FORBIDDEN')
ALLOWED={'api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','omc.xiaoa.cyou'}
def trusted(url,loopback=False):
 u=urllib.parse.urlparse(url)
 return not u.username and not u.password and ((u.scheme=='https' and u.hostname in ALLOWED and u.port in (None,443)) or (loopback and u.scheme=='http' and u.hostname=='127.0.0.1'))
def fetch_bounded(url,deadline,max_bytes,no_redirect=False,allow_loopback=False):
 if not trusted(url,allow_loopback) or not (0<max_bytes<=2*1024*1024):raise ValueError('FETCH_ORIGIN_OR_SIZE_INVALID')
 remaining=deadline-time.monotonic()
 if remaining<=0.5:raise TimeoutError('HTTP_DEADLINE')
 args=[sys.executable,str(__file__),'--child','--url',url,'--max-bytes',str(max_bytes),'--socket-timeout',str(min(20,remaining))]
 if no_redirect:args.append('--no-redirect')
 if allow_loopback:args.append('--allow-loopback')
 p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0),start_new_session=(sys.platform!='win32'))
 try:
  left=deadline-time.monotonic()-0.5
  if left<=0:raise subprocess.TimeoutExpired(args,0)
  out,_=p.communicate(timeout=left)
 except subprocess.TimeoutExpired:
  p.kill()
  try:p.wait(timeout=0.4)
  except subprocess.TimeoutExpired:pass
  if p.stdout:p.stdout.close()
  raise TimeoutError('HTTP_DEADLINE')
 if p.returncode or time.monotonic()>=deadline:raise ValueError('HTTP_FETCH_FAILED_OR_LATE')
 obj=json.loads(out);raw=base64.b64decode(obj['body'],validate=True)
 if len(raw)>max_bytes or not trusted(obj['url'],allow_loopback) or (no_redirect and obj['url']!=url):raise ValueError('HTTP_RESPONSE_INVALID')
 return obj['status'],obj['url'],obj.get('date'),raw
def child(a):
 if not trusted(a.url,a.allow_loopback):raise ValueError('UNTRUSTED_URL')
 class Redirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,req,fp,code,msg,headers,newurl):
   if a.no_redirect or not trusted(newurl,a.allow_loopback):raise ValueError('UNTRUSTED_REDIRECT')
   return super().redirect_request(req,fp,code,msg,headers,newurl)
 req=urllib.request.Request(a.url,headers={'User-Agent':'OMC-QA-handoff-executor','Accept':'application/vnd.github+json','Cache-Control':'no-cache'})
 try:
  with urllib.request.build_opener(Redirect()).open(req,timeout=a.socket_timeout) as r:
   raw=r.read(a.max_bytes+1);status=r.status;url=r.url;date=r.headers.get('Date')
 except urllib.error.HTTPError as e:
  status=e.code;url=e.geturl();date=e.headers.get('Date');raw=b'';e.close()
 if len(raw)>a.max_bytes or not trusted(url,a.allow_loopback) or (a.no_redirect and url!=a.url):raise ValueError('HTTP_RESPONSE_INVALID')
 print(json.dumps({'status':status,'url':url,'date':date,'body':base64.b64encode(raw).decode('ascii')}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--child',action='store_true');p.add_argument('--url');p.add_argument('--max-bytes',type=int);p.add_argument('--socket-timeout',type=float);p.add_argument('--no-redirect',action='store_true');p.add_argument('--allow-loopback',action='store_true');a=p.parse_args()
 if not a.child:raise RuntimeError('CHILD_MODE_REQUIRED')
 child(a)
