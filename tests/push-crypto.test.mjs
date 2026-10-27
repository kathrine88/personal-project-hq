// Optional: WEB_PUSH_MODULE points to installed web-push (3.6.7) or an ESM bundle.
import test from 'node:test';import assert from 'node:assert/strict';import {createECDH,randomBytes,hkdfSync,createDecipheriv,createPublicKey,verify} from 'node:crypto';
test('standard web-push library produces decryptable RFC8291 aes128gcm and a valid VAPID ES256 JWT',{skip:!process.env.WEB_PUSH_MODULE},async()=>{
 const module=await import(process.env.WEB_PUSH_MODULE);const webpush=module.default||module;
 const vapid=webpush.generateVAPIDKeys(),receiver=createECDH('prime256v1');receiver.generateKeys();const auth=randomBytes(16),receiverPublic=receiver.getPublicKey();
 const payload=JSON.stringify({kind:'test',tag:'test'}),endpoint='https://web.push.apple.com/example';
 const details=webpush.generateRequestDetails({endpoint,keys:{p256dh:receiverPublic.toString('base64url'),auth:auth.toString('base64url')}},payload,{TTL:60,contentEncoding:'aes128gcm',vapidDetails:{subject:'mailto:owner@example.com',...vapid}});
 assert.equal(details.headers['Content-Encoding'],'aes128gcm');
 const body=details.body,salt=body.subarray(0,16),sender=body.subarray(21,21+body[20]);
 const secret=receiver.computeSecret(sender),ikm=hkdfSync('sha256',secret,auth,Buffer.concat([Buffer.from('WebPush: info\0'),receiverPublic,sender]),32);
 const cek=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
 const ciphertext=body.subarray(21+body[20]);const decrypt=createDecipheriv('aes-128-gcm',cek,nonce);decrypt.setAuthTag(ciphertext.subarray(-16));
 const plaintext=Buffer.concat([decrypt.update(ciphertext.subarray(0,-16)),decrypt.final()]);assert.equal(plaintext.subarray(0,-1).toString(),payload);assert.equal(plaintext.at(-1),2);
 const jwt=details.headers.Authorization.match(/t=([^, ]+)/)[1],parts=jwt.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
 assert.equal(claims.aud,new URL(endpoint).origin);assert.equal(claims.sub,'mailto:owner@example.com');
 const raw=Buffer.from(vapid.publicKey,'base64url'),publicKey=createPublicKey({key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')},format:'jwk'});
 assert.equal(verify('sha256',Buffer.from(parts.slice(0,2).join('.')),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')),true);
});
