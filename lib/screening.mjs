import {randomUUID} from 'node:crypto';
import {CheckrTenant} from './checkr-tenant.mjs';
export const SCREENING_PRICE=7900;
export const TERMS_VERSION='2026-10-28-test';
export function testConfiguration(env=process.env){
 if(env.SCREENING_TEST_ENABLED!=='true')throw Error('Screening test checkout is unavailable');
 if(!env.CHECKR_TEST_API_KEY?.startsWith('ckr_sk_test_'))throw Error('Checkr test credentials required');
 const origin=new URL(env.SCREENING_TEST_SITE_URL||'');
 const link=new URL(env.STRIPE_SCREENING_TEST_PAYMENT_URL||'');
 if(origin.protocol!=='https:'||link.origin!=='https://buy.stripe.com'||!link.pathname.startsWith('/test_')||!env.STRIPE_SCREENING_TEST_LINK_ID?.startsWith('plink_'))throw Error('Test configuration required');
 return {origin:origin.origin,paymentUrl:link.href,linkId:env.STRIPE_SCREENING_TEST_LINK_ID};
}
export function paymentForApplication(event,a){
 const s=event.data?.object;
 return ['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&event.livemode===false&&s?.livemode===false&&s.mode==='payment'&&s.payment_status==='paid'&&s.currency==='usd'&&s.amount_total===SCREENING_PRICE&&a.amount_cents===SCREENING_PRICE&&s.metadata?.aplynx_service==='tenant_screening'&&s.metadata?.terms_version===TERMS_VERSION&&s.payment_link===a.stripe_payment_link_id&&s.client_reference_id===a.id+'_'+a.payment_reference&&a.terms_accepted_at!=null;
}
export async function createCheckout(a,{key,origin,fetcher=fetch}){
 const params=new URLSearchParams({mode:'payment',client_reference_id:a.id,customer_email:a.applicant.email,success_url:origin+'/screening-payment.html?result=received',cancel_url:origin+'/screening-payment.html?result=canceled','line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(SCREENING_PRICE),'line_items[0][price_data][product_data][name]':'APLYNX application and Essential screening — TEST','metadata[aplynx_service]':'tenant_screening','metadata[terms_version]':TERMS_VERSION,integration_identifier:'aplynx_screening_qjvntkxa'});
 const r=await fetcher('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded','Stripe-Version':'2026-09-30.endive','Idempotency-Key':'screening-checkout-'+a.id},body:params,signal:AbortSignal.timeout(20000)});
 const s=await r.json();if(!r.ok||s.livemode!==false||!s.id?.startsWith('cs_test_')||!s.url?.startsWith('https://checkout.stripe.com/'))throw Error('Test checkout unavailable');return {stripe_session_id:s.id,checkout_url:s.url};
}
export async function fulfillScreening(event,{store,client=new CheckrTenant()}){
 const id=event.data?.object?.client_reference_id?.split('_')[0];if(!/^[a-f0-9-]{36}$/.test(id||''))return 'ignored';
 const a=await store.get(id);if(!a||!paymentForApplication(event,a))return 'ignored';
 // A database compare-and-set prevents concurrent/replayed events creating test orders.
 // Checkr test mode itself does not deduplicate idempotency keys.
 if(!await store.claim(a.id)){if(a.stripe_session_id&&a.stripe_session_id!==event.data.object.id)await store.reviewDuplicate(a.id,event.data.object.id);return 'already_claimed';}
 try{
  await store.update(a.id,{stripe_session_id:event.data.object.id});
  const order=await client.create({property:a.property,applicant:a.applicant,original_requester:a.original_requester||undefined,idempotencyKey:a.checkr_idempotency_key});
  if(!order.id?.startsWith('ord_test_')||order.live_mode!==false)throw Error('Test order required');
  await store.update(a.id,{status:order.status,checkr_order_id:order.id,application_url:order.application_url||null,paid_at:new Date(event.created*1000).toISOString()});return 'ordered';
 }catch(e){
  // An ambiguous timeout must be reconciled by staff, never automatically reordered.
  await store.update(a.id,{status:'needs_review'});throw e;
 }
}
export function validateInvitation(b){
 const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Check application details');return v.trim();};
 const applicant={first_name:text(b.applicant?.first_name,100),last_name:text(b.applicant?.last_name,100),email:text(b.applicant?.email,254).toLowerCase()};if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant.email))throw Error('Check email');
 const p=b.property||{};if(p.state!=='GA'||!/^\d{5}$/.test(p.zipcode||''))throw Error('Georgia test property required');
 if(b.availability_confirmed!==true||b.fee_rules_reviewed!==true||b.own_organization!==true)throw Error('Confirm availability, fee review and own-organization screening');
 return {id:randomUUID(),applicant,property:{street:text(p.street,240),city:text(p.city,100),state:'GA',zipcode:p.zipcode,...(p.unit?{unit:text(p.unit,80)}:{})},amount_cents:SCREENING_PRICE,checkr_idempotency_key:randomUUID(),status:'invited',terms_version:TERMS_VERSION};
}
