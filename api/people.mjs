import { deliverInvite } from './maintenance.mjs';
const json = (data, status=200) => new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = value => typeof value==='string' && value.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
async function db(env,path,{method='GET',body,token,service=true}={}) {
 const key=service?env.SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_ANON_KEY;
 const r=await fetch(env.SUPABASE_URL+path,{method,headers:{apikey:key,Authorization:`Bearer ${token||key}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok) { const e=await r.json().catch(()=>({})); throw Object.assign(new Error(e.message||e.msg||'Unable to update records'),{status:r.status}); }
 const text=await r.text();return text?JSON.parse(text):null;
}
async function mail(env,to,text) {
 if(!env.RESEND_API_KEY||!env.MAINTENANCE_FROM_EMAIL) throw Error('Email delivery is not configured');
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.MAINTENANCE_FROM_EMAIL,to:[to],subject:'Confirm your Aplynx login email change',text})});
 if(!r.ok)throw Error('Email delivery failed. Retry the verification request.');
}
export async function handle(request,env=process.env) {
 if(!['GET','POST'].includes(request.method)) return json({error:'Method not allowed'},405);
 if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'People management is not configured'},503);
 if(request.method==='POST'&&request.headers.get('origin')!==new URL(request.url).origin)return json({error:'Invalid request origin'},403);
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return json({error:'Sign in with your website administrator account'},401);
 let actor;
 try{actor=await db(env,'/auth/v1/user',{token,service:false});}catch{return json({error:'Sign in again to continue'},401);}
 try{
  const allowed=await db(env,'/rest/v1/maintenance_admins?email=eq.'+encodeURIComponent(actor.email?.toLowerCase()||'')+'&select=email');
  if(!actor.id||!actor.email_confirmed_at||!allowed.length)return json({error:'Only an approved Aplynx administrator can manage people'},403);
  if(request.method==='GET'){
   const page=Math.max(1,Math.min(10000,Number(new URL(request.url).searchParams.get('page'))||1));
   const [accounts,profiles,properties,tenants,invites,audit]=await Promise.all([
    db(env,`/auth/v1/admin/users?page=${page}&per_page=200`),
    db(env,'/rest/v1/maintenance_profiles?select=id,email,contact_email,name,phone,updated_at'),
    db(env,'/rest/v1/maintenance_properties?select=id,address,owner_id,manager_id,mode'),
    db(env,'/rest/v1/maintenance_tenants?select=property_id,user_id'),
    db(env,'/rest/v1/maintenance_invites?accepted_at=is.null&order=created_at.desc&limit=200'),
    db(env,'/rest/v1/maintenance_admin_audit?select=id,action,created_at,subject_id&order=created_at.desc&limit=20')]);
   return json({actor:actor.email,page,hasNext:accounts.users.length===200,
    users:accounts.users.map(u=>({id:u.id,email:u.email,pending_email:u.new_email||null,created_at:u.created_at,confirmed:Boolean(u.email_confirmed_at)})),profiles,properties,tenants,invites,audit});
  }
  const raw=await request.text();if(raw.length>4096)return json({error:'Request too large'},413);
  let b;try{b=JSON.parse(raw);}catch{return json({error:'Invalid request'},400);}
  if(!b||Array.isArray(b)||!uuid.test(b.id||''))return json({error:'Choose a valid record'},400);
  if(b.action==='login_email'){
   const next=(b.email||'').trim().toLowerCase();if(!email(next))return json({error:'Enter a valid login email'},400);
   const target=await db(env,`/auth/v1/admin/users/${b.id}`);
   const protectedAccounts=await db(env,'/rest/v1/maintenance_admins?email=eq.'+encodeURIComponent(target.email)+'&select=email');
   if(protectedAccounts.length)return json({error:'Administrator login emails must be changed through account settings'},400);
   if(next===target.email)return json({error:'This is already the login email'},400);
   if(!env.RESEND_API_KEY||!env.MAINTENANCE_FROM_EMAIL)return json({error:'Email delivery is not configured'},503);
   // Native Auth email changes keep the old login until confirmation. Never return verification tokens to the administrator.
   const base=env.MAINTENANCE_SITE_URL||'https://www.aplynxinvestments.com';
   for(const [type,destination] of [['email_change_current',target.email],['email_change_new',next]]){
    const link=await db(env,'/auth/v1/admin/generate_link',{method:'POST',body:{type,email:target.email,new_email:next,redirect_to:new URL('/maintenance.html',base).href}});
    const verification=new URL(link.action_link);
    if(verification.origin!==new URL(env.SUPABASE_URL).origin)throw Error('Verification link unavailable');
    await mail(env,destination,`An Aplynx administrator requested a login email change to ${next}. Confirm only if this is your account. Your current login stays in place until the required confirmations are complete.\n\n${verification.href}\n\nIf your old mailbox is unavailable, contact Aplynx for account recovery.`);
   }
   await db(env,'/rest/v1/maintenance_admin_audit',{method:'POST',body:{actor_id:actor.id,action:'login_email_requested',subject_id:b.id,details:{new_email:next}}});
   return json({ok:true,message:'Verification emails sent to the current and new addresses. The login changes after confirmation.'});
  }
  if(!['profile','invite','cancel_invite','remove'].includes(b.action))return json({error:'Unknown action'},400);
  if(b.action==='profile'&&(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>120||typeof b.phone!=='string'||b.phone.length>40||typeof b.contact_email!=='string'||(b.contact_email&&!email(b.contact_email))))return json({error:'Check the name, phone, and contact email'},400);
  if(b.action==='invite'&&b.email!==undefined&&!email(b.email))return json({error:'Enter a valid invitation email'},400);
  if(b.action==='remove'&&!uuid.test(b.property||''))return json({error:'Choose a property'},400);
  const result=await db(env,'/rest/v1/rpc/maintenance_admin_action',{method:'POST',body:{p_actor:actor.id,p_action:b.action,p_input:b}});
  if(result.invite){
   const invitations=await db(env,'/rest/v1/maintenance_invites?id=eq.'+result.invite+'&select=*');
   try{await deliverInvite(env,invitations[0]);}
   catch{return json({ok:true,message:'Invitation saved, but email delivery failed. It is listed as not sent; use Resend after checking email delivery.'});}
  }
  return json({ok:true,message:b.action==='remove'?'Property access removed. Conversation history is preserved.':b.action==='invite'?'Invitation sent. The previous invitation is expired.':b.action==='cancel_invite'?'Invitation canceled.':'Contact details saved. Login email was unchanged.'});
 }catch(e){return json({error:e.status===422?'That email may already belong to another account. Check the address.':e.message||'Unable to update records'},400);}
}
export default {fetch:request=>handle(request,process.env)};
