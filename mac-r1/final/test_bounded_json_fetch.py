import http.server,threading,time,unittest
from bounded_json_fetch import fetch_bounded
class Server(http.server.ThreadingHTTPServer):daemon_threads=True
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path=='/slow':
   self.send_response(200);self.send_header('Content-Length','1000');self.end_headers()
   try:
    for _ in range(1000):self.wfile.write(b'x');self.wfile.flush();time.sleep(.1)
   except (BrokenPipeError,ConnectionResetError):pass
  elif self.path=='/redirect':self.send_response(302);self.send_header('Location','/ok');self.end_headers()
  elif self.path=='/missing':self.send_response(404);self.end_headers()
  else:self.send_response(200);self.end_headers();self.wfile.write(b'{"ok":true}')
 def log_message(self,*args):pass
class FetchTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.server=Server(('127.0.0.1',0),Handler);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start();cls.base='http://127.0.0.1:'+str(cls.server.server_port)
 @classmethod
 def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
 def test_slow_trickle_is_interrupted_by_absolute_deadline(self):
  started=time.monotonic()
  with self.assertRaises(TimeoutError):fetch_bounded(self.base+'/slow',started+1.5,16384,no_redirect=True,allow_loopback=True)
  self.assertLess(time.monotonic()-started,1.7)
 def test_success_404_and_redirect_policy(self):
  for suffix,status in [('/ok',200),('/missing',404)]:self.assertEqual(fetch_bounded(self.base+suffix,time.monotonic()+5,16384,no_redirect=True,allow_loopback=True)[0],status)
  with self.assertRaises(ValueError):fetch_bounded(self.base+'/redirect',time.monotonic()+5,16384,no_redirect=True,allow_loopback=True)
if __name__=='__main__':unittest.main()
