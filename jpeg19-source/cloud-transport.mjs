import fs from 'node:fs';
import {createDecipheriv,createCipheriv,createHash,randomBytes} from 'node:crypto';
const [mode,input,output,metadata]=process.argv.slice(2),key=Buffer.from(process.env.OMC_PREVIEW15_TRANSPORT_KEY||'','hex');
if(key.length!==32)throw Error('TRANSPORT_KEY');
const sha=b=>createHash('sha256').update(b).digest('hex');
const data=fs.readFileSync(input);
if(mode==='decrypt'){
 const m=JSON.parse(fs.readFileSync(metadata,'utf8'));if(data.length!==m.ciphertextBytes||sha(data)!==m.ciphertextSha256)throw Error('CIPHER_IDENTITY');
 const c=createDecipheriv('aes-256-gcm',key,Buffer.from(m.nonceHex,'hex'));
 if(m.id)c.setAAD(Buffer.from(`omc-aes256gcm-build-transport-v1|${m.id}|${m.plaintextSha256}|${m.plaintextBytes}`));
 c.setAuthTag(Buffer.from(m.tagHex,'hex'));
 const plain=Buffer.concat([c.update(data),c.final()]);if(plain.length!==m.plaintextBytes||sha(plain)!==m.plaintextSha256)throw Error('PLAIN_IDENTITY');fs.writeFileSync(output,plain,{flag:'wx'});
}else if(mode==='encrypt'){
 const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce),cipher=Buffer.concat([c.update(data),c.final()]);fs.writeFileSync(output,cipher,{flag:'wx'});
 fs.writeFileSync(metadata,JSON.stringify({schema:'omc-cloud-evidence-aes256gcm-v1',plaintextBytes:data.length,plaintextSha256:sha(data),ciphertextBytes:cipher.length,ciphertextSha256:sha(cipher),nonceHex:nonce.toString('hex'),tagHex:c.getAuthTag().toString('hex')},null,2));
}else throw Error('MODE');
