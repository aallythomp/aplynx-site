import {randomUUID} from 'node:crypto';
import {ORIGINS,BUCKET,sb,owned,photoType} from '../lib/listings.mjs';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'POST required'});if(!ORIGINS.has(req.headers.origin))return res.status(403).json({error:'Invalid origin'});
 try{const row=await owned(req.headers['x-listing-id'],req.headers['x-listing-token']);if(!row)return res.status(404).json({error:'Submission not found'});if(row.completed_at||row.status!=='pending')return res.status(409).json({error:'Photos cannot change after submission. Contact our team for changes.'});
 const chunks=[];let n=0;for await(const chunk of req){n+=chunk.length;if(n>2097152)return res.status(413).json({error:'Photo must be under 2 MB after resizing'});chunks.push(chunk);}const buf=Buffer.concat(chunks),mime=photoType(buf);if(!mime||mime!==req.headers['content-type'])return res.status(400).json({error:'Upload a JPEG, PNG, or WebP photo'});
 const path=row.id+'/'+randomUUID()+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[mime];
 const reservation=await sb('/rest/v1/rpc/reserve_rental_photo',{method:'POST',body:{p_listing:row.id,p_path:path}});if(!reservation)return res.status(409).json({error:'Maximum 12 photos per listing'});
 try{await sb('/storage/v1/object/'+BUCKET+'/'+path,{method:'POST',body:buf,headers:{'Content-Type':mime,'x-upsert':'false'}});await sb('/rest/v1/rental_listing_photos?object_path=eq.'+encodeURIComponent(path),{method:'PATCH',body:{uploaded:true}});}catch(e){await sb('/rest/v1/rental_listing_photos?object_path=eq.'+encodeURIComponent(path),{method:'DELETE'});throw e;}
 return res.json({success:true});
 }catch(e){return res.status(400).json({error:e.message||'Photo upload failed'});}}
