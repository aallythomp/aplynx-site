import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../api/people.mjs';
const actor='00000000-0000-0000-0000-000000000001',target='00000000-0000-0000-0000-000000000002';
const env={SUPABASE_URL:'https://database.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret',RESEND_API_KEY:'email-secret',MAINTENANCE_FROM_EMAIL:'Aplynx <mail@example.com>',MAINTENANCE_SITE_URL:'https://www.aplynxinvestments.com'};
const req=(body,token='admin-token',origin='https://www.aplynxinvestments.com')=>new Request(origin+'/api/people',{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),Origin:origin},body:body?JSON.stringify(body):undefined});
const json=d=>new Response(JSON.stringify(d));
test('missing identity, external origin, and non-admin identity cannot manage records',async()=>{
 assert.equal((await handle(req(null,null),env)).status,401);
 const forged=req({action:'remove',id:target,property:actor});forged.headers.set('Origin','https://attacker.example');assert.equal((await handle(forged,env)).status,403);
 const previous=global.fetch;let requests=0;global.fetch=async url=>{requests++;return json(url.endsWith('/auth/v1/user')?{id:target,email:'tenant@example.com',email_confirmed_at:'2026-01-01'}:[]);};
 try{assert.equal((await handle(req({action:'remove',id:target,property:actor}),env)).status,403);assert.equal(requests,2);}finally{global.fetch=previous;}
});
test('actor comes from verified session and contact edits cannot change the login email',async()=>{
 const previous=global.fetch;let sent;global.fetch=async(url,options)=>{
  if(url.endsWith('/auth/v1/user')){assert.equal(options.headers.Authorization,'Bearer admin-token');return json({id:actor,email:'admin@example.com',email_confirmed_at:'2026-01-01'});}
  if(url.includes('maintenance_admins'))return json([{email:'admin@example.com'}]);
  if(url.endsWith('maintenance_admin_action')){sent=JSON.parse(options.body);return json({ok:true});}throw Error('Unexpected call');
 };try{const r=await handle(req({action:'profile',id:target,p_actor:target,name:'Tenant',phone:'',contact_email:'new@example.com'}),env);assert.equal(r.status,200);assert.equal(sent.p_actor,actor);assert.equal(sent.p_action,'profile');assert.match((await r.json()).message,/Login email was unchanged/);}finally{global.fetch=previous;}
});
test('login change uses native verification sent to both addresses and never exposes tokens',async()=>{
 const previous=global.fetch;const deliveries=[],links=[];global.fetch=async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return json({id:actor,email:'admin@example.com',email_confirmed_at:'2026-01-01'});
  if(url.includes('maintenance_admins'))return json(url.includes('old%40example.com')?[]:[{email:'admin@example.com'}]);
  if(url.endsWith('/admin/users/'+target))return json({id:target,email:'old@example.com'});
  if(url.endsWith('/admin/generate_link')){links.push(JSON.parse(options.body));return json({action_link:'https://database.example/auth/v1/verify?token=private-verification-token'});}
  if(url==='https://api.resend.com/emails'){deliveries.push(JSON.parse(options.body));return json({id:'sent'});}
  if(url.endsWith('maintenance_admin_audit'))return new Response(null,{status:201});throw Error('Unexpected call');
 };try{const r=await handle(req({action:'login_email',id:target,email:'new@example.com'}),env);assert.equal(r.status,200);assert.deepEqual(links.map(x=>x.type),['email_change_current','email_change_new']);assert.ok(links.every(x=>x.new_email==='new@example.com'));assert.deepEqual(deliveries.map(x=>x.to[0]),['old@example.com','new@example.com']);assert.doesNotMatch(await r.text(),/private-verification-token|email-secret/);}finally{global.fetch=previous;}
});
