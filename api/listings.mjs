import {ORIGINS,sb,parseListing,owned,publicOwnerRow,signedPhoto} from '../lib/listings.mjs';
const limits=new Map();
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(req.method==='GET'){try{await sb('/rest/v1/rental_listings?select=id&limit=0');await sb('/storage/v1/bucket/aplynx-listing-photos');return res.json({ready:true});}catch{return res.status(503).json({ready:false,error:'Photo submissions are temporarily unavailable while our team completes the secure storage connection. Please call (833) 393-1935 for help.'});}}if(req.method!=='POST')return res.status(405).json({error:'POST required'});
 if(!ORIGINS.has(req.headers.origin))return res.status(403).json({error:'Invalid origin'});
 const ip=String(req.headers['x-forwarded-for']||'unknown').split(',')[0],now=Date.now();for(const [k,v]of limits)if(v.until<now)limits.delete(k);const q=limits.get(ip)||{n:0,until:now+600000};limits.set(ip,q);if(++q.n>60)return res.status(429).json({error:'Please wait before trying again'});
 try{const b=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!b||JSON.stringify(b).length>15000||b.botcheck)throw Error('Invalid submission');
 if(b.action==='create'){
 const row=parseListing(b);const existing=await sb('/rest/v1/rental_listings?submission_reference=eq.'+row.submission_reference+'&select=id,owner_token_hash');if(existing.length){if(existing[0].owner_token_hash!==row.owner_token_hash)return res.status(409).json({error:'This submission reference is already in use'});return res.json({success:true,id:existing[0].id});}
 const rows=await sb('/rest/v1/rental_listings',{method:'POST',body:row,headers:{Prefer:'return=representation'}});return res.json({success:true,id:rows[0].id});
 }
 const row=await owned(b.id,b.token);if(!row)return res.status(404).json({error:'Submission not found. Use the saved access code for this listing.'});
 const photos=await sb('/rest/v1/rental_listing_photos?listing_id=eq.'+row.id+'&uploaded=eq.true&select=object_path&order=created_at');
 if(b.action==='submit'){
 if(!photos.length)return res.status(400).json({error:'Upload at least one property photo'});
 if(!row.completed_at){const done=await sb('/rest/v1/rpc/finalize_rental_submission',{method:'POST',body:{p_listing:row.id}});if(!done)return res.status(409).json({error:'Wait for all photo uploads to finish before submitting'});}
 let notified=row.notification_sent===true;if(!notified){try{await notifyListing(row,photos.length);await sb('/rest/v1/rental_listings?id=eq.'+row.id,{method:'PATCH',body:{notification_sent:true}});notified=true;}catch{}}return res.json({success:true,status:row.status,notified});
 }
 if(b.action==='status'){
 const promotion=(await sb('/rest/v1/rental_promotions?listing_id=eq.'+row.id+'&payment_status=eq.paid&ends_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=tier,starts_at,ends_at&limit=1'))[0]||null;
 return res.json({success:true,listing:publicOwnerRow(row,await Promise.all(photos.map(p=>signedPhoto(p.object_path)))),promotion});
 }
 if(b.action==='checkout'){
 if(row.status!=='approved'||!row.published_at)return res.status(409).json({error:'Your listing must be approved and published before payment'});
 if(!['featured','premium'].includes(row.selected_tier))return res.status(409).json({error:'Your basic listing is free'});
 if(!process.env.STRIPE_LISTING_WEBHOOK_SECRET)return res.status(503).json({error:'Stripe checkout setup is awaiting secure authorization. Your listing remains saved.'});
 const active=await sb('/rest/v1/rental_promotions?listing_id=eq.'+row.id+'&payment_status=eq.paid&ends_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=id&limit=1');if(active.length)return res.status(409).json({error:'This listing already has an active paid promotion'});
 const tier=row.selected_tier,link=process.env['STRIPE_'+tier.toUpperCase()+'_LINK_URL'];if(!link||new URL(link).hostname!=='buy.stripe.com')return res.status(503).json({error:'Stripe checkout is awaiting authorization'});
 const orders=await sb('/rest/v1/rental_checkout_orders?listing_id=eq.'+row.id+'&select=id');let order=orders[0];if(!order){order=(await sb('/rest/v1/rental_checkout_orders?on_conflict=listing_id',{method:'POST',body:{listing_id:row.id,tier},headers:{Prefer:'resolution=ignore-duplicates,return=representation'}}))[0];if(!order)order=(await sb('/rest/v1/rental_checkout_orders?listing_id=eq.'+row.id+'&select=id'))[0];}
 return res.json({success:true,url:link+'?client_reference_id='+encodeURIComponent(order.id)});
 }
 return res.status(400).json({error:'Unknown listing action'});
 }catch(e){return res.status(400).json({error:e.message||'Could not process this listing'});}
}

async function notifyListing(row,count){
 const endpoint=process.env.CRM_LEAD_ENDPOINT;if(endpoint!=='https://aplynx-client-hub.hands-on-cha-3500.chatgpt.site/api/leads'||!process.env.CRM_WEBSITE_LEAD_KEY||!process.env.CRM_SITES_SERVICE_TOKEN||!process.env.WEB3FORMS_ACCESS_KEY)throw Error('Notification unavailable');
 const lead={submission_id:row.submission_reference,name:row.owner_name,email:row.owner_email,phone:row.owner_phone,inquiry_type:'management',submitted_at:row.created_at,area:row.city,requirements:'Rental listing awaiting review: '+row.id+'\nProperty: '+row.street_address+' '+(row.unit||'')+'\nCity: '+row.city+'\nPackage: '+row.selected_tier+'\nUploaded photos: '+count+'\n'+row.description};
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+process.env.CRM_WEBSITE_LEAD_KEY,'OAI-Sites-Authorization':'Bearer '+process.env.CRM_SITES_SERVICE_TOKEN};const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(lead),signal:AbortSignal.timeout(12000),redirect:'error'});const d=await r.json();if(!r.ok||!d.ok)throw Error('CRM notification unavailable');
 const mail=await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_key:process.env.WEB3FORMS_ACCESS_KEY,subject:'APLYNX listing awaiting review',from_name:'APLYNX Property Submissions',name:row.owner_name,email:row.owner_email,message:lead.requirements+'\nReview in your administrator portal: https://www.aplynxinvestments.com/listing-admin.html',botcheck:''}),signal:AbortSignal.timeout(12000)});const m=await mail.json();if(!mail.ok||m.success!==true)throw Error('Email notification unavailable');
 const confirm=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({action:'notification_received',submission_id:row.submission_reference}),signal:AbortSignal.timeout(12000),redirect:'error'});if(!confirm.ok)throw Error('Notification confirmation unavailable');
}
