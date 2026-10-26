// Pin dependencies. Dashboard: add core.js beside this file, then deploy.
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';
import webpush from 'npm:web-push@3.6.7';
import { createECDH } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createPushHandler } from './core.js';
const env = (name: string) => Deno.env.get(name) || '';
const key = (modern: string, legacy: string) => {
  const dictionary = env(modern);
  return dictionary ? JSON.parse(dictionary).default : env(legacy);
};
const options = { auth: { persistSession: false, autoRefreshToken: false } };
Deno.serve(createPushHandler({
  env,
  userClient: (token: string) => createClient(env('SUPABASE_URL'),key('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'),{
    ...options,global:{headers:{Authorization:`Bearer ${token}`}}
  }),
  adminClient: () => createClient(env('SUPABASE_URL'),key('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),options),
  validateVapid: () => {
    // Fail before consuming any delivery claim if keys/subject are misconfigured.
    const pair=createECDH('prime256v1');
    pair.setPrivateKey(Buffer.from(env('VAPID_PRIVATE_KEY'),'base64url'));
    if(pair.getPublicKey().toString('base64url')!==env('VAPID_PUBLIC_KEY')) throw Error('VAPID key mismatch');
    webpush.getVapidHeaders('https://web.push.apple.com',env('VAPID_SUBJECT'),env('VAPID_PUBLIC_KEY'),env('VAPID_PRIVATE_KEY'),'aes128gcm');
  },
  preparePush: (subscription: object,payload: string,settings: object) => webpush.generateRequestDetails(subscription,payload,settings)
}));
