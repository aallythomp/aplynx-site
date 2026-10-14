import {sb,signedPhoto} from '../lib/listings.mjs';
export default async function handler(req,res){res.setHeader('Cache-Control','public, s-maxage=30, stale-while-revalidate=30');if(req.method!=='GET')return res.status(405).json({error:'GET required'});
 try{const listings=await sb('/rest/v1/aplynx_public_rentals?select=*&order=published_at.desc&limit=100');const photos=listings.length?await sb('/rest/v1/rental_listing_photos?listing_id=in.('+listings.map(x=>x.id).join(',')+')&uploaded=eq.true&select=listing_id,object_path&order=created_at'):[];
 const result=await Promise.all(listings.map(async x=>({...x,photo_urls:photos.some(p=>p.listing_id===x.id)?await Promise.all(photos.filter(p=>p.listing_id===x.id).map(p=>signedPhoto(p.object_path))):x.photo_urls})));
 const rank={premium:2,featured:1,basic:0};result.sort((a,b)=>(rank[b.promotion_tier]||0)-(rank[a.promotion_tier]||0));return res.json({listings:req.query?.promoted==='premium'?result.filter(x=>x.promotion_tier==='premium'):result});
 }catch{return res.status(503).json({error:'Rental directory temporarily unavailable'});}}
