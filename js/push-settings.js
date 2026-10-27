// Display only our known diagnostic codes, never raw HTTP/database/provider text.
export async function pushFailureMessage(error){
  const fallback='Push service could not complete this request. Check your connection and sign-in, then refresh notification settings.';
  try{
    const body=await error.context.clone().text();if(body.length>4096)return fallback;
    const detail=JSON.parse(body);
    const messages={
      PUSH_DEVICE_NOT_ENABLED:'Enable notifications for this device, then retry.',
      PUSH_TEST_RATE_LIMITED:'Wait a minute before sending another test.',
      PUSH_DATABASE_ERROR:'The notification database step failed. Use the diagnostic below with the push test fix guide.',
      PUSH_SUBSCRIPTION_EXPIRED:'This subscription expired. Enable notifications again.',
      PUSH_TEST_SKIPPED:'The test claim expired or this device was disabled. Refresh settings before retrying.',
      PUSH_PROVIDER_REJECTED:'The push provider rejected the test. Check the provider status below.',
      PUSH_DELIVERY_UNKNOWN:'Delivery could not be confirmed. Check your iPhone before testing again.',
      PUSH_SERVICE_UNAVAILABLE:'Notification setup is unavailable. Check the Edge Function configuration.'
    };
    if(!Object.hasOwn(messages,detail.code))return fallback;
    const parts=[detail.code];
    if(['test_claim','begin','finish','provider','configuration','dispatch_claim','database'].includes(detail.stage))parts.push(detail.stage);
    if(/^[A-Z0-9]{5,9}$/.test(detail.dbCode||''))parts.push(detail.dbCode);
    if(Number.isInteger(detail.providerStatus)&&detail.providerStatus>=0&&detail.providerStatus<=599)parts.push('HTTP '+detail.providerStatus);
    if(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(detail.requestId||''))parts.push('Reference '+detail.requestId);
    return messages[detail.code]+' ('+parts.join('; ')+')';
  }catch{return fallback;}
}
const STORAGE_KEY='hq-push-device-id:';
const decodeKey=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
export function pushSupport(win=window) {
  if(!win.isSecureContext || !('Notification' in win) || !('PushManager' in win) || !win.navigator.serviceWorker)
    return 'Notifications are unsupported in this browser. Use a current iPhone with iOS 16.4 or later.';
  const ios=/iPad|iPhone|iPod/.test(win.navigator.userAgent) || (win.navigator.platform==='MacIntel'&&win.navigator.maxTouchPoints>1);
  if(ios && !win.matchMedia('(display-mode: standalone)').matches && !win.navigator.standalone)
    return 'Install from Safari → Share → Add to Home Screen, then open the Home Screen app to enable notifications.';
  return '';
}
export function createPushSettings({root,client,isSignedIn}) {
  const status=root.querySelector('[data-push-status]'),error=root.querySelector('[data-push-error]'),
    enable=root.querySelector('[data-push-enable]'),disable=root.querySelector('[data-push-disable]'),test=root.querySelector('[data-push-test]');
  let busy=false,epoch=0,device=null,config=null,subscription=null;
  const memoryIds=new Map();
  const getId=owner=>{let id=memoryIds.get(owner);if(id)return id;try{id=localStorage.getItem(STORAGE_KEY+owner);}catch{}
    if(!/^[0-9a-f-]{36}$/i.test(id||'')){id=crypto.randomUUID();try{localStorage.setItem(STORAGE_KEY+owner,id);}catch{}}
    memoryIds.set(owner,id);return id;
  };
  let id=null;
  async function resolveId(){const {data,error}=await client.auth.getSession();const owner=data?.session?.user?.id;if(error||!owner)throw Error('Sign in again to manage this device.');return getId(owner);}
  async function rpc(action,sub=null,key=null,target=id){const {data,error}=await client.rpc('hq_push_device',{p_id:target,p_action:action,p_subscription:sub,p_vapid_key:key});if(error)throw Error('Could not save notification settings. Check your connection and Stage 3C-B setup, then refresh settings.');return data;}
  async function invoke(action){const {data,error}=await client.functions.invoke('reminder-push',{body:{action,deviceId:id}});if(error)throw Error(await pushFailureMessage(error));return data;}
  function render(){
    const unsupported=pushSupport(),signed=isSignedIn(),permission=typeof Notification==='undefined'?'default':Notification.permission;
    status.textContent=unsupported||(!signed?'Sign in to manage notifications for this device.':permission==='denied'?
      'Blocked in iPhone notification settings. Allow notifications for Project HQ in Settings, then return here.':
      permission==='granted'&&device?.enabled&&subscription?'Enabled for this device.'+(!config?.deliveryEnabled?' Automatic reminder delivery is not active yet.':''):
      'Notifications are off for this device. Enable to receive future due reminders.');
    enable.disabled=busy||!!unsupported||!signed||permission==='denied'||!config?.publicKey;
    enable.hidden=!!(permission==='granted'&&device?.enabled&&subscription);
    disable.disabled=busy||!signed||(!device?.enabled&&!subscription);
    test.disabled=busy||!signed||!device?.enabled||!subscription||permission!=='granted'||!config?.publicKey;
    root.querySelector('[data-push-refresh]').disabled=busy;
  }
  async function refresh(){
    if(busy)return;const token=++epoch;error.textContent='';
    if(pushSupport()||!isSignedIn()){device=null;config=null;subscription=null;render();return;}
    busy=true;render();
    try{
      const currentId=await resolveId();if(token!==epoch)return;id=currentId;
      const registration=await navigator.serviceWorker.getRegistration(new URL('../',import.meta.url).href);
      const [settings,sub]=await Promise.all([invoke('config'),registration?.pushManager.getSubscription()]);
      const record=await rpc('status',sub?.toJSON()||null);
      if(token!==epoch)return;
      config=settings;device=record;subscription=sub||null;
      if(device?.enabled && (!subscription || Notification.permission!=='granted')){
        device=await rpc('disable');
      }
      if(subscription&&device?.enabled&&device.matches===false){
        device=await rpc('disable');error.textContent='This subscription changed. Enable notifications again for this device.';
      }
      if(subscription&&device?.vapid_key&&device.vapid_key!==config.publicKey){
        device=await rpc('disable');await subscription.unsubscribe();subscription=null;
        error.textContent='The notification key changed. Enable notifications again for this device.';
      }
    }catch(e){if(token===epoch)error.textContent=e.message;}finally{if(token===epoch){busy=false;render();}}
  }
  async function stop(){
    // Server first: offline failures are visible and never reported as disabled.
    const target=id||await resolveId();await rpc('disable',null,null,target);
    const registration=await navigator.serviceWorker.getRegistration(new URL('../',import.meta.url).href);
    const sub=await registration?.pushManager.getSubscription();
    if(sub&&!await sub.unsubscribe())throw Error('Server delivery is disabled. Close/reopen the app and retry to remove the browser subscription.');
    device=null;subscription=null;
  }
  enable.addEventListener('click',async()=>{
    if(busy||pushSupport()||!isSignedIn()||!config?.publicKey)return;
    // Called synchronously from the click, BEFORE any await (required by iOS).
    const permission=Notification.requestPermission();
    busy=true;error.textContent='';render();const token=epoch;
    try{
      if(await permission!=='granted')throw Error('Notifications were not allowed. You can change this in iPhone Settings.');
      const registration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Home Screen app setup is not ready. Reopen the app and try again.')),10000))]);
      if(token!==epoch||!isSignedIn())return;
      let sub=await registration.pushManager.getSubscription();
      // Never transfer an existing browser endpoint silently between accounts.
      if(sub&&!device?.enabled){await sub.unsubscribe();sub=null;}
      sub=sub||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(config.publicKey)});
      if(token!==epoch||!isSignedIn()){await sub.unsubscribe();return;}
      try{device=await rpc('enable',sub.toJSON(),config.publicKey);subscription=sub;}
      catch(e){await sub.unsubscribe();throw e;}
    }catch(e){if(token===epoch)error.textContent=e.message;}finally{if(token===epoch){busy=false;render();}}
  });
  disable.addEventListener('click',async()=>{if(busy)return;busy=true;error.textContent='';render();try{await stop();}catch(e){error.textContent=e.message;}finally{busy=false;render();}});
  test.addEventListener('click',async()=>{if(busy)return;busy=true;error.textContent='';render();let message='';try{const result=await invoke('test');message=result.message;}catch(e){message=e.message;}finally{busy=false;await refresh();error.textContent=message;render();}});
  root.addEventListener('toggle',()=>{if(root.open)void refresh();});
  root.querySelector('[data-push-refresh]').addEventListener('click',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&root.open)void refresh();});
  navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='HQ_PUSH_CHANGED')void refresh();});
  render();
  return {refresh,reset(){epoch++;busy=false;device=null;config=null;subscription=null;id=null;render();},
    async beforeSignOut(){if(busy)throw Error('Wait for notification settings to finish, then sign out again.');if(pushSupport())return;const reg=await navigator.serviceWorker.getRegistration(new URL('../',import.meta.url).href);const sub=await reg?.pushManager.getSubscription();if(sub||device?.enabled)await stop();},
    async signedOut(){epoch++;device=null;config=null;subscription=null;busy=false;render();
      // Auth may be revoked outside the app; remove the local endpoint as a fallback.
      try{const reg=await navigator.serviceWorker?.getRegistration(new URL('../',import.meta.url).href);const old=await reg?.pushManager.getSubscription();if(!isSignedIn())await old?.unsubscribe();}catch{}
    }};
}
