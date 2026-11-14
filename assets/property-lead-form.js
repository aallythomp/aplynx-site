// APLYNX property inquiry — CRM first; no email app opens for buyers.
(() => {
  "use strict";
  const dialog=document.getElementById("aplynx-lead-dialog");
  const gallery=document.getElementById("aplynx-gallery");
  const form=document.getElementById("aplynx-property-lead");
  if(!dialog||!form)return;
  const status=document.getElementById("lead-status");
  const success=document.getElementById("lead-success");
  const pane=document.getElementById("lead-form-pane");
  let requestedProperty="";
  document.addEventListener("click",e=>{
    const button=e.target.closest(".property-request");
    if(!button)return;
    e.preventDefault();
    const card=button.closest(".property");
    requestedProperty=(card?.querySelector("h2")?.textContent||document.getElementById("gallery-address")?.textContent||"Homes for sale").trim();
    document.getElementById("lead-property").value=requestedProperty;
    form.reset();
    document.getElementById("lead-property").value=requestedProperty;
    status.textContent="";
    pane.classList.remove("hidden");
    success.classList.add("hidden");
    document.getElementById("lead-email-confirmation")?.classList.add("hidden");
    status.classList.remove("error");
    if(gallery?.open)gallery.close();
    dialog.showModal();
    document.getElementById("lead-name").focus();
  });
  document.querySelectorAll(".lead-close").forEach(b=>b.addEventListener("click",()=>dialog.close()));
  form.addEventListener("submit",async e=>{
    e.preventDefault();
    if(!form.reportValidity()||form.elements.botcheck.value)return;
    if(form.getAttribute("aria-busy")==="true")return;
    const submit=form.querySelector('[type="submit"]');
    submit.disabled=true;form.setAttribute("aria-busy","true");status.textContent="Sending your request…";
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),22000);
    try{
      const name=form.elements.name.value.trim(),email=form.elements.email.value.trim(),phone=form.elements.phone.value.trim();
      const property=form.elements.property.value.trim();
      const reference="APX-"+crypto.randomUUID();
      const submitted=new Date().toISOString();
      const lines=[["Name",name],["Email",email],["Phone",phone],["Property",property],["Interest","Request a home showing"],["Preferred showing date",form.elements.preferredDate.value||"Not specified"],["Questions",form.elements.note.value.trim()||"None"],["Contact consent","Yes"],["Submitted at",submitted]];
      const message=["APLYNX Investments — Property Showing Request","Reference: "+reference,...lines.map(([k,v])=>k+": "+v)].join("\n");
      const payload={reference,submitted_at:submitted,form_kind:"aplynx-property-lead",lines,botcheck:""};
      const notification={subject:"Showing request: "+property+" | "+name+" | "+reference,from_name:"APLYNX Investments",name,email,message,botcheck:""};
      if(typeof deliverWebsiteInquiry!=="function")throw Error("Inquiry service unavailable");
      const response=await deliverWebsiteInquiry(form,payload,notification,controller.signal);
      const result=await response.json();
      if(!response.ok||result.success!==true)throw Error("Submission not confirmed");
      pane.classList.add("hidden");success.classList.remove("hidden");document.getElementById("lead-email-confirmation")?.classList.toggle("hidden",result.auto_reply_sent!==true);success.focus();
      form.reset();
    }catch(error){
      status.textContent="We couldn't confirm your request. Please try again or call APLYNX at 833-393-1935.";
      status.classList.add("error");
    }finally{
      clearTimeout(timeout);submit.disabled=false;form.removeAttribute("aria-busy");
    }
  });
})();
