/* APLYNX app install assistant: Android install prompt and iOS Share instructions. */
(() => {
 const button=document.getElementById('aplynx-install-button');
 const guide=document.getElementById('aplynx-install-guide');
 const details=document.getElementById('aplynx-install-steps');
 if(!button||!guide||!details)return;
 let pending=null;
 const standalone=window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;
 if(standalone){guide.hidden=true;return;}
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
 const safari=/Safari/.test(navigator.userAgent)&&!/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
 const instructions=ios?(safari?'In Safari, tap the Share icon (square with an upward arrow), choose Add to Home Screen, then tap Add.':'Open this page in Safari, tap Share, then Add to Home Screen and Add.'):'In your browser menu, look for Install app or Add to Home screen.';
 details.textContent=instructions;
 if(ios){button.textContent='How to install on iPhone';guide.hidden=false;}
 window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();pending=event;guide.hidden=false;button.textContent='Install APLYNX App';details.textContent='Add APLYNX to your phone and open it like an app.';
 });
 button.addEventListener('click',async()=>{
  if(pending){const event=pending;pending=null;await event.prompt();const choice=await event.userChoice;if(choice?.outcome==='accepted')guide.hidden=true;else{details.hidden=false;button.textContent='How to install';}return;}
  details.hidden=!details.hidden;
 });
 window.addEventListener('appinstalled',()=>{guide.hidden=true;pending=null;});
 if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{}));}
})();