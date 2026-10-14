// Notifications and CRM credentials are handled by the website server.
async function deliverWebsiteInquiry(form,payload,notification,signal){
 const request=async body=>{const r=await fetch('/api/inquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});const d=await r.json();if(!r.ok||!d.success)throw Error('Inquiry delivery needs a retry');return d;};
 await request(payload);await request({...payload,action:'send_notification'});await request({...payload,action:'confirm_notification'});return Response.json({success:true});
}
