// Public, read-only rental directory. Owner information is never returned.
const expected='https://xobkinawxphmdcoaaxvs.supabase.co';
export default async function handler(req,res){
 res.setHeader('Cache-Control','public, s-maxage=60, stale-while-revalidate=120');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const url=process.env.SUPABASE_URL?.replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(url!==expected||!key)return res.status(503).json({error:'Rental directory unavailable'});
 try{
  const upstream=await fetch(url+'/rest/v1/aplynx_public_rentals?select=id,property_type,city,state,postal_code,monthly_rent,deposit,bedrooms,bathrooms,available_on,description,photo_urls,application_url,published_at&order=published_at.desc&limit=100',{
   headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(8000)
  });
  if(!upstream.ok)throw Error('Database query failed');
  const listings=await upstream.json();
  return res.status(200).json({listings});
 }catch(e){console.error('Rental directory error',String(e.message).slice(0,100));return res.status(503).json({error:'Rental directory temporarily unavailable'});}
}