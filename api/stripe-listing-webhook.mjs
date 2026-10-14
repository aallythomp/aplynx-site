import {sb} from '../lib/listings.mjs';
import {verifyStripeEvent,paidPromotion} from '../lib/stripe-listing.mjs';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'POST required'});if(!process.env.STRIPE_LISTING_WEBHOOK_SECRET)return res.status(503).json({error:'Webhook not configured'});
 let event;try{let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>1048576)throw Error();chunks.push(c);}event=verifyStripeEvent(Buffer.concat(chunks),req.headers['stripe-signature'],process.env.STRIPE_LISTING_WEBHOOK_SECRET);}catch{return res.status(400).json({error:'Invalid Stripe signature'});}
 try{const params=paidPromotion(event,{featured:process.env.STRIPE_FEATURED_LINK_ID,premium:process.env.STRIPE_PREMIUM_LINK_ID});if(params)await sb('/rest/v1/rpc/fulfill_rental_payment',{method:'POST',body:params});
 if(event.livemode===true&&event.type==='charge.refunded'&&event.data?.object?.refunded===true){const x=event.data.object;if(typeof x.payment_intent==='string'&&x.payment_intent.startsWith('pi_'))await sb('/rest/v1/rental_promotions?stripe_payment_intent_id=eq.'+encodeURIComponent(x.payment_intent),{method:'PATCH',body:{payment_status:'refunded'}});}
 if(event.livemode===true&&event.type==='checkout.session.async_payment_failed'){const x=event.data?.object;if(x?.metadata?.aplynx_service==='rental_promotion')await sb('/rest/v1/rental_payment_reviews?on_conflict=stripe_session_id',{method:'POST',body:{stripe_session_id:x.id,reason:'Stripe reported failed delayed payment. No promotion was started.'},headers:{Prefer:'resolution=ignore-duplicates'}});}
 return res.json({received:true});
 }catch{return res.status(503).json({error:'Payment recording unavailable; Stripe can retry safely'});}}
