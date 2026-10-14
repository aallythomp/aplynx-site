import webpush from 'web-push';
const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
export async function handle(request,env=process.env,{fetcher=fetch,send=(subscription,payload,options)=>webpush.sendNotification(subscription,payload,options)}={}){
 if(request.method==='GET')return response({ready:env.AGENT_HUB_READY==='true'&&!!env.SUPABASE_URL&&!!env.SUPABASE_ANON_KEY,url:env.SUPABASE_URL||null,key:env.SUPABASE_ANON_KEY||null,vapid_public:env.AGENT_HUB_VAPID_PUBLIC||null,payments:false});
 if(request.method!=='POST')return response({error:'Method not allowed.'},405);
 if(request.headers.get('origin')&&!['https://www.aplynxinvestments.com','https://aplynxinvestments.com'].includes(request.headers.get('origin')))return response({error:'Invalid request origin.'},403);
 const bearer=request.headers.get('authorization');if(!/^Bearer [\w.-]+$/.test(bearer||''))return response({error:'Sign in required.'},401);
 if(env.AGENT_HUB_READY!=='true'||!env.AGENT_HUB_VAPID_PRIVATE||!env.AGENT_HUB_VAPID_PUBLIC)return response({error:'Job alerts are not configured. The job remains saved in the dashboard.'},503);
 let input;try{const raw=await request.text();if(raw.length>300)return response({error:'Request too large.'},413);input=JSON.parse(raw);}catch{return response({error:'Invalid request.'},400);}
 if(!/^[0-9a-f-]{36}$/i.test(input?.job_id||''))return response({error:'One valid job ID required.'},400);
 try{
 // The caller's JWT is checked by Supabase. This RPC only returns subscriptions
 // to an authorized hub administrator for a currently open job.
 const r=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/agent_hub_notify_targets',{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:bearer,'Content-Type':'application/json'},body:JSON.stringify({p_job:input.job_id})});
 if(!r.ok)return response({error:'Only an authorized APLYNX administrator can notify agents about an open job.'},403);
 const subscriptions=await r.json();if(!Array.isArray(subscriptions)||subscriptions.length>1000)throw Error('Invalid audience');
 let delivered=0,failed=0;for(const sub of subscriptions){try{const endpoint=new URL(sub.endpoint);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||!(endpoint.hostname==='fcm.googleapis.com'||endpoint.hostname==='updates.push.services.mozilla.com'||endpoint.hostname.endsWith('.push.apple.com')))throw Error('Unsupported endpoint');await send(sub,JSON.stringify({job_id:input.job_id}),{TTL:300,urgency:'normal',vapidDetails:{subject:'mailto:info@aplynxinvestments.com',publicKey:env.AGENT_HUB_VAPID_PUBLIC,privateKey:env.AGENT_HUB_VAPID_PRIVATE}});delivered++;}catch{failed++;}}
 return response({delivered,failed,delivery_guaranteed:false});
 }catch{return response({error:'Job alerts could not be sent. The saved job remains on the dashboard.'},502);}
}
export default async function handler(req,res){const headers=new Headers();for(const [k,v]of Object.entries(req.headers||{}))if(v!=null)headers.set(k,Array.isArray(v)?v.join(','):String(v));const request=new Request('https://www.aplynxinvestments.com/api/agent-hub',{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:typeof req.body==='string'?req.body:JSON.stringify(req.body||{})}:{})});const r=await handle(request);res.status(r.status);for(const[k,v]of r.headers)res.setHeader(k,v);res.send(await r.text());}
