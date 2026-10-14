import {createHmac,timingSafeEqual} from 'node:crypto';
export function verifyStripeEvent(raw,signature,secret,now=Date.now()){
 if(!secret||!Buffer.isBuffer(raw)||raw.length>1048576)throw Error('Webhook unavailable');
 const parts=String(signature||'').split(','),t=parts.find(x=>x.startsWith('t='))?.slice(2),v=parts.filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));
 if(!/^\d+$/.test(t||'')||Math.abs(now/1000-Number(t))>300)throw Error('Invalid webhook signature');
 const expected=createHmac('sha256',secret).update(t+'.').update(raw).digest();if(!v.some(x=>/^[a-f0-9]{64}$/.test(x)&&timingSafeEqual(expected,Buffer.from(x,'hex'))))throw Error('Invalid webhook signature');return JSON.parse(raw.toString('utf8'));
}
export function paidPromotion(event,links){if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return null;const x=event.data?.object,tier=x?.metadata?.aplynx_tier;if(event.livemode!==true||x?.livemode!==true||x.payment_status!=='paid'||x.currency!=='usd'||x.mode!=='payment'||!['featured','premium'].includes(tier)||x.metadata.aplynx_service!=='rental_promotion'||x.payment_link!==links[tier]||x.amount_total!==(tier==='featured'?1999:3999))return null;if(!/^[0-9a-f-]{36}$/.test(x.client_reference_id||'')||!x.id?.startsWith('cs_')||!x.payment_intent?.startsWith('pi_'))return null;return {p_event:event.id,p_type:event.type,p_order:x.client_reference_id,p_session:x.id,p_intent:x.payment_intent,p_tier:tier,p_amount:x.amount_total,p_paid_at:new Date(event.created*1000).toISOString()};}
