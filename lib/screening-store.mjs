// Dedicated test database: never reuse the production client-records database.
async function request(path,{method='GET',body,headers={}}={}){
 const url=process.env.SCREENING_TEST_SUPABASE_URL?.replace(/\/$/,'');const key=process.env.SCREENING_TEST_SUPABASE_SERVICE_KEY;
 if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url||'')||url==='https://xobkinawxphmdcoaaxvs.supabase.co'||!key)throw Error('Separate screening test database required');
 const r=await fetch(url+'/rest/v1/screening_applications'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Screening test storage unavailable');return r.status===204?null:await r.json();
}
export const screeningStore={
 async get(id){return (await request('?id=eq.'+encodeURIComponent(id)+'&select=*'))[0]||null;},
 async create(a){await request('',{method:'POST',body:a});},
 async update(id,body){await request('?id=eq.'+encodeURIComponent(id),{method:'PATCH',body});},
 async saveCheckout(id,body){await request('?id=eq.'+encodeURIComponent(id)+'&status=eq.invited',{method:'PATCH',body:{...body,status:'checkout_created',terms_accepted_at:new Date().toISOString()}});},
 async claim(id){const rows=await request('?id=eq.'+encodeURIComponent(id)+'&status=eq.checkout_created',{method:'PATCH',body:{status:'ordering'},headers:{Prefer:'return=representation'}});return rows.length===1;}
};
