import {randomBytes,timingSafeEqual} from 'node:crypto';
import {hash,uuid} from '../lib/listings.mjs';
import {testConfiguration,validateInvitation,TERMS_VERSION} from '../lib/screening.mjs';
import {screeningStore as store} from '../lib/screening-store.mjs';
import {CheckrTenant,reportSummary} from '../lib/checkr-tenant.mjs';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 try{
  const cfg=testConfiguration();
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(req.headers.origin!==cfg.origin)return res.status(403).json({error:'Invalid origin'});
  const b=req.body||{};
  if(['invite','refresh','connectivity','smoke'].includes(b.action)){
   const expected=process.env.SCREENING_TEST_ADMIN_TOKEN,actual=String(req.headers.authorization||'').replace(/^Bearer /,'');
   if(!expected||expected.length<32||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.status(401).json({error:'Administrator sign-in required'});
   if(b.action==='connectivity'){await new CheckrTenant().request('/orders?per_page=1');return res.json({connected:true,mode:'test'});}
   if(b.action==='smoke'){
    const client=new CheckrTenant();const o=await client.request('/orders',{method:'POST',idempotencyKey:randomBytes(16).toString('hex'),body:{order:{package:'essential',payer:'organization',property:{street:'1 Market St',city:'San Francisco',state:'CA',zipcode:'94105'},applicant:{first_name:'Herbert',last_name:'Humphrey',email:'herbert.humphrey@example.com',dob:'1996-04-27',ssn:'111-11-1111'}}}});
    if(o.live_mode!==false||!o.id?.startsWith('ord_test_'))throw Error();return res.json({order_id:o.id,status:o.status,live_mode:false});
   }
   if(b.action==='invite'){
    const a=validateInvitation(b),token=randomBytes(32).toString('hex');await store.create({...a,token_hash:hash(token),payment_reference:randomBytes(24).toString('hex'),stripe_payment_link_id:cfg.linkId});
    return res.json({id:a.id,url:cfg.origin+'/screening-payment.html#application='+a.id+'&token='+token});
   }
   if(!uuid(b.id))return res.status(400).json({error:'Invalid application'});
   const a=await store.get(b.id);if(!a?.checkr_order_id)return res.status(404).json({error:'Order unavailable'});
   const client=new CheckrTenant(),order=await client.status(a.checkr_order_id);let summary={};
   if(order.status==='completed'){const report=await client.report(order.id);if(report)summary=reportSummary(report);}
   await store.update(a.id,{status:order.status,...summary});return res.json({id:a.id,status:order.status,...summary});
  }
  if(!uuid(b.id)||! /^[a-f0-9]{64}$/.test(b.token||''))return res.status(404).json({error:'Invitation unavailable'});
  const a=await store.get(b.id);if(!a||a.token_hash!==hash(b.token))return res.status(404).json({error:'Invitation unavailable'});
  if(b.action==='view')return res.json({id:a.id,amount_cents:a.amount_cents,status:a.status,property:a.property,terms_version:TERMS_VERSION});
  if(b.action!=='checkout'||b.accepted_terms!==TERMS_VERSION)return res.status(400).json({error:'Review and accept application terms'});
  if(!['invited','checkout_created'].includes(a.status))return res.status(409).json({error:'This application has already been processed'});
  if(a.checkout_url)return res.json({url:a.checkout_url});
  const url=new URL(cfg.paymentUrl);url.searchParams.set('client_reference_id',a.id+'_'+a.payment_reference);url.searchParams.set('prefilled_email',a.applicant.email);const session={checkout_url:url.href};await store.saveCheckout(a.id,session);return res.json({url:session.checkout_url});
 }catch{return res.status(503).json({error:'Test screening unavailable. Contact APLYNX; no live checkout is enabled.'});}
}
