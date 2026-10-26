import {createHmac, timingSafeEqual} from 'node:crypto';
import {sb} from '../lib/listings.mjs';

// Checkr Tenant's Tenant-Signature uses HMAC-SHA256 over timestamp.rawBody.
// This endpoint intentionally fails closed until a signing secret and durable
// event storage are configured. It never returns report details to callers.
export const config={api:{bodyParser:false}};
export function verifyTenantSignature(raw,header,secret,now=Math.floor(Date.now()/1000)){
  if(!secret || typeof header!=='string') return false;
  const match=/^t=(\d{10,}),v1=([a-f0-9]{64})$/i.exec(header.trim());
  if(!match) return false;
  const ts=Number(match[1]);
  if(!Number.isSafeInteger(ts)||Math.abs(now-ts)>300)return false;
  const expected=createHmac('sha256',secret).update(match[1]+'.').update(raw).digest();
  const actual=Buffer.from(match[2],'hex');
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(process.env.VERCEL_ENV!=='preview' || !process.env.CHECKR_TEST_WEBHOOK_SECRET){
    return res.status(503).json({error:'Webhook not enabled'});
  }
  let raw;
  try{
    const chunks=[];let length=0;
    for await(const c of req){length+=c.length;if(length>262144) return res.status(413).end();chunks.push(c);}
    raw=Buffer.concat(chunks);
  }catch{return res.status(400).end();}
  // Checkr dashboard sends an unsigned, empty-body connectivity probe.\n  if(raw.length===0 && !req.headers['tenant-signature'] && req.headers['user-agent']==='CheckrTenant/1')return res.status(204).end();\n  if(!verifyTenantSignature(raw,req.headers['tenant-signature'],process.env.CHECKR_TEST_WEBHOOK_SECRET))
    return res.status(401).json({error:'Invalid signature'});
  let event;
  try{event=JSON.parse(raw.toString('utf8'));}catch{return res.status(400).end();}
  if(event?.object!=='event'||!/^evt_[\w-]+$/.test(event?.id||'')||typeof event?.type!=='string')
    return res.status(400).end();
  // Record only non-sensitive identifiers; event ID is unique, making retries safe.
  // A database failure returns 503 so Checkr can retry delivery.
  const occurred=event.created_at || event.createdAt || event.created;
  const when=occurred ? new Date(typeof occurred==='number' ? occurred*1000 : occurred) : new Date();
  if(Number.isNaN(when.valueOf()))return res.status(400).end();
  // Checkr event data is a flat {id,order_id} envelope, not data.object.\n  const resource=event.data || {};
  try{
    await sb('/rest/v1/rental_screening_webhook_events?on_conflict=checkr_event_id',{
      method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:{
        checkr_event_id:event.id,event_type:event.type.slice(0,120),
        checkr_order_id:typeof resource.order_id==='string'?resource.order_id.slice(0,160):null,
        resource_id:typeof resource.id==='string'?resource.id.slice(0,160):null,
        occurred_at:when.toISOString(),environment:'test'
      }
    });
    return res.status(200).json({received:true});
  }catch{return res.status(503).json({error:'Webhook persistence unavailable'});}
}
