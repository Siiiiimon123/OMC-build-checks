import importlib.util,json,pathlib,sys,unittest
from unittest.mock import patch
here=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(here));spec=importlib.util.spec_from_file_location('mac_controller',here/'run.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class DeadlineTests(unittest.TestCase):
 def test_reply_after_deadline_is_rejected(self):
  now=[99.0];calls=[];url='https://example.invalid/ready';pkg='a'*64
  def fetch(u,until,limit,no_redirect=False):calls.append(until);now[0]=100.1;return (200,url,None,json.dumps({'ready':True,'sourceTreeMac':m.MAC,'packageSha256':pkg,'readyIssuedMonotonic':10,'serverDeadlineMonotonic':20}).encode())
  with patch.object(m.time,'monotonic',side_effect=lambda:now[0]),patch.object(m,'fetch_bounded',side_effect=fetch):self.assertFalse(m.await_qa_ready(url,100.0,pkg))
  self.assertEqual(calls,[100.0])
 def test_reply_before_deadline_is_accepted(self):
  url='https://example.invalid/ready';pkg='a'*64
  body=json.dumps({'ready':True,'sourceTreeMac':m.MAC,'packageSha256':pkg,'readyIssuedMonotonic':10,'serverDeadlineMonotonic':20}).encode()
  with patch.object(m.time,'monotonic',return_value=99),patch.object(m,'fetch_bounded',return_value=(200,url,None,body)):self.assertTrue(m.await_qa_ready(url,100,pkg))
if __name__=='__main__':unittest.main()
