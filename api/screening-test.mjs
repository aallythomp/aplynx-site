import {randomBytes,timingSafeEqual} from 'node:crypto';
import {hash,uuid} from '../lib/listings.mjs';
import {testConfiguration,validateInvitation,createCheckout,TERMS_VERSION} from '../lib/screening.mjs';
import {screeningStore as store} from '../lib/screening-store.mjs';
import {CheckrTenant,reportSummary} from '../lib/checkr-tenant.mjs';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 try{
  const cfg=testConfiguration();
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(req.headers.origin!==cfg.origin)return res.status(403).json({error:'Invalid origin'});
  const b=req.body||{};
  if(b.action==='invite'||b.action==='refresh'){
   const expected=process.env.SCREENING_TEST_ADMIN_TOKEN,actual=String(req.headers.authorization||'').replace(/^Bearer /,'');
   if(!expected||expected.length<32||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.status(401).json({error:'Administrator sign-in required'});
   if(b.action==='invite'){
    const a=validateInvitation(b),token=randomBytes(32).toString('hex');await store.create({...a,token_hash:hash(token)});
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
  const session=await createCheckout(a,{key:cfg.stripeKey,origin:cfg.origin});await store.saveCheckout(a.id,session);return res.json({url:session.checkout_url});
 }catch{return res.status(503).json({error:'Test screening unavailable. Contact APLYNX; no live checkout is enabled.'});}
}
