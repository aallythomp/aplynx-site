import {sb} from './listings.mjs';
// Synthetic test records only; isolated table, server-role access only.
async function request(path,options={}){return sb('/rest/v1/screening_test_applications'+path,options);}
export const screeningStore={
 async get(id){return (await request('?id=eq.'+encodeURIComponent(id)+'&select=*'))[0]||null;},
 async create(a){await request('',{method:'POST',body:a});},
 async update(id,body){await request('?id=eq.'+encodeURIComponent(id),{method:'PATCH',body});},
 async saveCheckout(id,body){await request('?id=eq.'+encodeURIComponent(id)+'&status=eq.invited',{method:'PATCH',body:{...body,status:'checkout_created',terms_accepted_at:new Date().toISOString()}});},
 async reviewDuplicate(id,session){await sb('/rest/v1/screening_test_payment_reviews',{method:'POST',body:{application_id:id,stripe_session_id:session,reason:'Duplicate paid test session; do not create a second screening.'},headers:{Prefer:'resolution=ignore-duplicates'}});},
 async claim(id){const rows=await request('?id=eq.'+encodeURIComponent(id)+'&status=eq.checkout_created',{method:'PATCH',body:{status:'ordering'},headers:{Prefer:'return=representation'}});return rows.length===1;}
};
