"""Synthetic RGB fixture using only standard library and macOS sips."""
import pathlib,struct,zlib,subprocess,sys
p=pathlib.Path(sys.argv[1]);w,h=320,240
def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
pixels=b''.join(b'\0'+bytes(v for x in range(w) for v in ((x*3+y)%256,(x+y*2)%256,((x//20+y//20)%2)*180+30)) for y in range(h))
png=p.with_suffix('.png');png.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b''))
subprocess.run(['/usr/bin/sips','-s','format','jpeg',str(png),'--out',str(p)],check=True,stdout=subprocess.DEVNULL)
