import {ORIGINS,sb,admin,config,signedPhoto,uuid,clearCookie} from '../lib/listings.mjs';
const attempts=new Map();
export default async function handler(req,res){res.setHeader('Cache-Control','private, no-store');if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});if(req.method==='POST'&&!ORIGINS.has(req.headers.origin))return res.status(403).json({error:'Invalid origin'});
 try{const b=req.method==='POST'?(typeof req.body==='string'?JSON.parse(req.body):req.body)||{}:{};
 if(b.action==='logout'){res.setHeader('Set-Cookie',clearCookie);return res.json({success:true});}
 if(b.action==='login'){
 const ip=String(req.headers['x-forwarded-for']||'unknown').split(',')[0],now=Date.now();for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);const q=attempts.get(ip)||{n:0,until:now+600000};attempts.set(ip,q);if(++q.n>10)return res.status(429).json({error:'Too many sign-in attempts. Try again in 10 minutes.'});
 if(String(b.email).toLowerCase()!==String(process.env.LISTING_ADMIN_EMAIL||'').toLowerCase()||typeof b.password!=='string'||b.password.length>256)return res.status(401).json({error:'Use your existing APLYNX administrator account'});
 const {url}=config();const r=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:b.email,password:b.password}),signal:AbortSignal.timeout(10000)});if(!r.ok)return res.status(401).json({error:'Sign-in failed. Use your existing Supabase password.'});const d=await r.json();if(!d.user?.email_confirmed_at)return res.status(401).json({error:'Verify your administrator email first'});
 res.setHeader('Set-Cookie','__Host-aplynx-listing-admin='+d.access_token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+Math.min(d.expires_in||3600,3600));return res.json({success:true});
 }
 const u=await admin(req);if(!u)return res.status(401).json({error:'Sign in to review listings'});
 if(req.method==='GET'){
 const listings=await sb('/rest/v1/rental_listings?completed_at=not.is.null&select=id,owner_name,owner_email,owner_phone,owner_role,property_type,street_address,unit,city,postal_code,monthly_rent,deposit,bedrooms,description,available_on,application_url,status,selected_tier,published_at,created_at,review_note&order=created_at.desc&limit=100');
 const photos=await sb('/rest/v1/rental_listing_photos?uploaded=eq.true&select=listing_id,object_path');const promotions=await sb('/rest/v1/rental_promotions?select=listing_id,tier,payment_status,ends_at&order=created_at.desc&limit=200');const exceptions=await sb('/rest/v1/rental_payment_reviews?select=stripe_session_id,reason,created_at&order=created_at.desc&limit=50');
 return res.json({success:true,listings:await Promise.all(listings.map(async x=>({...x,photos:await Promise.all(photos.filter(p=>p.listing_id===x.id).map(p=>signedPhoto(p.object_path))),promotions:promotions.filter(p=>p.listing_id===x.id)}))),payment_reviews:exceptions});
 }
 if(!uuid(b.id)||!['approve','reject','archive'].includes(b.action))return res.status(400).json({error:'Invalid review action'});
 const rows=await sb('/rest/v1/rental_listings?id=eq.'+b.id+'&select=*');const row=rows[0];if(!row||!row.completed_at)return res.status(409).json({error:'Listing has not been submitted for review'});
 const note=String(b.note||'').slice(0,1000);
 if(b.action==='approve'){
 const photos=await sb('/rest/v1/rental_listing_photos?listing_id=eq.'+row.id+'&uploaded=eq.true&select=object_path');if(!photos.length)return res.status(409).json({error:'At least one uploaded photo is required'});
 await sb('/rest/v1/rental_listings?id=eq.'+row.id,{method:'PATCH',body:{status:'approved',approved_at:new Date().toISOString(),approved_by:u.id,published_at:row.published_at||new Date().toISOString(),review_note:note},headers:{Prefer:'return=representation'}});
 }else{await sb('/rest/v1/rental_listings?id=eq.'+row.id,{method:'PATCH',body:{status:b.action==='reject'?'rejected':'archived',published_at:null,review_note:note},headers:{Prefer:'return=representation'}});}
 return res.json({success:true});
 }catch(e){return res.status(503).json({error:e.message||'Listing review is temporarily unavailable'});}}
