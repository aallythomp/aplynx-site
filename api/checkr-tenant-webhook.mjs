import {createHmac, timingSafeEqual} from 'node:crypto';

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
  if(!verifyTenantSignature(raw,req.headers['tenant-signature'],process.env.CHECKR_TEST_WEBHOOK_SECRET))
    return res.status(401).json({error:'Invalid signature'});
  let event;
  try{event=JSON.parse(raw.toString('utf8'));}catch{return res.status(400).end();}
  if(event?.object!=='event'||!/^evt_[\w-]+$/.test(event?.id||'')||typeof event?.type!=='string')
    return res.status(400).end();
  // Never acknowledge until events can be durably recorded with a unique
  // event id. Checkr retries non-2xx responses. No PII or reports logged.
  return res.status(503).json({error:'Event persistence not configured'});
}
