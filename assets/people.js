import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm';
const $=id=>document.getElementById(id), el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let db,data,page=1,confirmation,busy=false;
const tell=text=>{$('notice').textContent=text;};
if(new URL(location.href).searchParams.get('embed')==='1')document.body.classList.add('embedded');
async function api(input){const {data:{session}}=await db.auth.getSession();if(!session)throw Error('Sign in with your website administrator account');const r=await fetch('/api/people'+(input?'':`?page=${page}`),{method:input?'POST':'GET',headers:{Authorization:`Bearer ${session.access_token}`,...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to load records');return d;}
function button(text,action,cls='secondary'){const b=el('button',text,cls);b.addEventListener('click',action);return b;}
const prop=id=>data.properties.find(p=>p.id===id)?.address||'Property';
function memberships(user){const result=data.tenants.filter(t=>t.user_id===user.id).map(t=>({property:t.property_id,role:'Tenant'}));for(const p of data.properties){if(p.owner_id===user.id)result.push({property:p.id,role:'Owner'});if(p.manager_id===user.id)result.push({property:p.id,role:'Aplynx manager'});}return result;}
function render(){
 const query=$('search').value.toLowerCase().trim();$('people').replaceChildren();let count=0;
 for(const u of data.users){const p=data.profiles.find(p=>p.id===u.id),access=memberships(u);if(![p?.name,u.email,p?.contact_email,p?.phone,...access.map(a=>prop(a.property))].join(' ').toLowerCase().includes(query))continue;count++;
  const card=el('article',undefined,'card'),top=el('div',undefined,'person'),details=el('div'),actions=el('div',undefined,'actions');
  details.append(el('h2',p?.name||u.email||'Website account'),el('p',`Login: ${u.email}`),el('p',`Contact: ${p?.contact_email||p?.email||u.email}${p?.phone?' · '+p.phone:''}`));
  if(u.pending_email)details.append(el('small',`Pending login change: ${u.pending_email}`));
  actions.append(button('Edit contact',()=>{ $('edit-id').value=u.id;$('edit-name').value=p?.name||'';$('edit-email').value=p?.contact_email||p?.email||u.email;$('edit-phone').value=p?.phone||'';open('edit-dialog');}));
  if(u.email!==data.actor)actions.append(button('Change login email',()=>{$('login-id').value=u.id;$('current-email').textContent='Current login: '+u.email;$('new-email').value='';open('login-dialog');}));
  top.append(details,actions);card.append(top);const list=el('div',undefined,'access');
  if(!access.length)list.append(el('small','No active property access.'));
  for(const a of access){const row=el('div',undefined,'access-row');row.append(el('span',`${a.role} · ${prop(a.property)}`));if(u.email!==data.actor)row.append(button('Remove access',()=>confirm('Remove property access?',`${p?.name||u.email} will lose access to ${prop(a.property)} and its conversations. Saved history will remain.`,{action:'remove',id:u.id,property:a.property})));list.append(row);}
  card.append(list);$('people').append(card);
 }
 if(!count)$('people').append(el('div',query?'No people match this search.':'No website accounts yet. Invite tenants and owners from the maintenance portal.','card'));
 $('summary').textContent=`${count} website account${count===1?'':'s'} on this page`;$('page').textContent=`Page ${page}`;$('prev').disabled=page===1;$('next').disabled=!data.hasNext;
 $('invites').replaceChildren();const invites=data.invites.filter(i=>($('expired').checked||new Date(i.expires_at)>new Date())&&[i.email,prop(i.property_id)].join(' ').toLowerCase().includes(query));
 if(!invites.length)$('invites').append(el('p','No pending invitations.'));
 for(const i of invites){const row=el('div',undefined,'invite-row'),info=el('div'),actions=el('div',undefined,'actions');info.append(el('strong',i.email),el('p',`${i.role} · ${prop(i.property_id)}`),el('small',`${new Date(i.expires_at)>new Date()?'Expires':'Expired'} ${new Date(i.expires_at).toLocaleDateString()} · ${i.email_sent_at?'Email sent':'Email not sent'}`));
  actions.append(button('Correct / resend',()=>{$('invite-id').value=i.id;$('invite-email').value=i.email;open('invite-dialog');}));if(new Date(i.expires_at)>new Date())actions.append(button('Cancel invitation',()=>confirm('Cancel invitation?',`The invitation for ${i.email} will expire immediately.`,{action:'cancel_invite',id:i.id})));row.append(info,actions);$('invites').append(row);
 }
 $('audit').replaceChildren(...data.audit.map(a=>el('div',`${a.action.replaceAll('_',' ')} · ${new Date(a.created_at).toLocaleString()}`,'audit-row')));if(!data.audit.length)$('audit').append(el('p','Admin changes will appear here.'));
}
function open(id){$(id).querySelector('.form-error').textContent='';$(id).showModal();}
function confirm(title,text,input){confirmation=input;$('confirm-title').textContent=title;$('confirm-text').textContent=text;open('confirm-dialog');}
async function load(){const {data:{session}}=await db.auth.getSession();$('login').hidden=Boolean(session);$('signout').hidden=!session;$('app').hidden=true;if(!session)return;data=await api();$('app').hidden=false;render();}
function form(id,action){$(id).addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;const buttons=[...e.currentTarget.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await action();}catch(err){const local=e.currentTarget.querySelector('.form-error');if(local)local.textContent=err.message;else tell(err.message);}finally{busy=false;buttons.forEach(b=>b.disabled=false);}});}
async function save(dialog,input){const d=await api(input);$(dialog).close();tell(d.message);await load();}
form('email-form',async()=>{const {error}=await db.auth.signInWithOtp({email:$('email').value.trim(),options:{emailRedirectTo:location.origin+'/admin-people.html'}});if(error)throw error;$('code-form').hidden=false;tell('Check your email for the sign-in link or code.');});
form('code-form',async()=>{const {error}=await db.auth.verifyOtp({email:$('email').value.trim(),token:$('code').value.trim(),type:'email'});if(error)throw error;$('code').value='';await load();tell('Signed in.');});
form('edit-form',()=>save('edit-dialog',{action:'profile',id:$('edit-id').value,name:$('edit-name').value.trim(),contact_email:$('edit-email').value.trim().toLowerCase(),phone:$('edit-phone').value.trim()}));
form('invite-form',()=>save('invite-dialog',{action:'invite',id:$('invite-id').value,email:$('invite-email').value.trim().toLowerCase()}));
form('login-change-form',()=>save('login-dialog',{action:'login_email',id:$('login-id').value,email:$('new-email').value.trim().toLowerCase()}));
form('confirm-form',()=>save('confirm-dialog',confirmation));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
for(const id of ['search','expired'])$(id).addEventListener('input',()=>{if(data)render();});
for(const [id,delta] of [['prev',-1],['next',1]])$(id).addEventListener('click',()=>{page+=delta;load().catch(e=>tell(e.message));});
 $('refresh').addEventListener('click',()=>load().catch(e=>tell(e.message)));$('signout').addEventListener('click',async()=>{await db.auth.signOut();data=null;await load();tell('Signed out.');});
try{const r=await fetch('/api/maintenance'),config=await r.json();if(!config.ready)throw Error('Website administration is being configured.');db=createClient(config.url,config.key);await load();}catch(e){tell(e.message);}
