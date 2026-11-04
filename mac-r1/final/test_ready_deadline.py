import importlib.util,json,pathlib,sys,unittest
from unittest.mock import patch
here=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(here));spec=importlib.util.spec_from_file_location('mac_controller',here/'run.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class DeadlineTests(unittest.TestCase):
 def test_reply_after_deadline_is_rejected(self):
  now=[99.0];calls=[];url='https://example.invalid/ready';pkg='a'*64
  class Response:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   @property
   def url(self):return url
   def read(self,n):now[0]=100.1;return json.dumps({'ready':True,'sourceTreeMac':m.MAC,'packageSha256':pkg,'readyIssuedMonotonic':10,'serverDeadlineMonotonic':20}).encode()
  def fetch(u,timeout):calls.append(timeout);return Response()
  with patch.object(m.time,'monotonic',side_effect=lambda:now[0]),patch.object(m.urllib.request,'urlopen',side_effect=fetch):self.assertFalse(m.await_qa_ready(url,100.0,pkg))
  self.assertEqual(calls,[1.0])
 def test_reply_before_deadline_is_accepted(self):
  url='https://example.invalid/ready';pkg='a'*64
  class Response:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   @property
   def url(self):return url
   def read(self,n):return json.dumps({'ready':True,'sourceTreeMac':m.MAC,'packageSha256':pkg,'readyIssuedMonotonic':10,'serverDeadlineMonotonic':20}).encode()
  with patch.object(m.time,'monotonic',return_value=99),patch.object(m.urllib.request,'urlopen',return_value=Response()):self.assertTrue(m.await_qa_ready(url,100,pkg))
if __name__=='__main__':unittest.main()
