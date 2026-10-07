export default {async fetch(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY;
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(!url||!key)return new Response(JSON.stringify({error:'Customer accounts are being connected. Please check back shortly.'}),{status:503,headers});
 let safe=key.startsWith('sb_publishable_');
 try{safe ||= JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='anon';}catch{}
 if(!safe||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))return new Response(JSON.stringify({error:'Customer accounts are being configured.'}),{status:503,headers});
 return new Response(JSON.stringify({url,key}),{headers});
}};
