/* APLYNX installer: native Android prompt plus iPhone guided install. */
(() => {
  'use strict';
  const button=document.getElementById('aplynx-install-button');
  const banner=document.getElementById('aplynx-install-guide');
  const dialog=document.getElementById('aplynx-install-dialog');
  const title=document.getElementById('install-dialog-title');
  const steps=document.getElementById('install-dialog-steps');
  const note=document.getElementById('install-dialog-note');
  const close=document.getElementById('install-dialog-close');
  const copy=document.getElementById('install-copy-link');
  if(!button||!banner||!dialog||!steps)return;
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const android=/Android/i.test(navigator.userAgent);
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const inApp=/FBAN|FBAV|Instagram|TikTok|Snapchat|MicroMessenger|ChatGPT|GSA\//i.test(navigator.userAgent);
  const safari=/Safari/.test(navigator.userAgent)&&!/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
  let promptEvent=null;
  function addStep(heading,description){
    const li=document.createElement('li');
    const strong=document.createElement('strong');strong.textContent=heading;
    const span=document.createElement('span');span.textContent=description;
    li.append(strong,span);steps.append(li);
  }
  function openInstructions(){
    steps.replaceChildren();
    if(ios){
      title.textContent='Add APLYNX to your iPhone';
      if(inApp||!safari)addStep('Open in Safari','Open www.aplynxinvestments.com in Safari. You can copy the address below.');
      addStep('Tap Share','Tap the Share icon (square with an upward arrow) in Safari.');
      addStep('Add to Home Screen','Choose Add to Home Screen, then tap Add.');
      note.textContent='Apple requires these confirmation steps. APLYNX will then appear on your home screen.';
    }else if(android){
      title.textContent='Install APLYNX on Android';
      addStep('Open in Chrome','Visit www.aplynxinvestments.com in Chrome.');
      addStep('Install','Choose Install app from the Chrome menu, then confirm.');
      note.textContent='When the browser offers an installation prompt, the Install APLYNX button opens it directly.';
    }else{
      title.textContent='Install APLYNX';
      addStep('Open on a phone','Visit www.aplynxinvestments.com from your mobile browser.');
      addStep('Add the app','Use your browser menu to install or add APLYNX to your home screen.');
      note.textContent='Installation varies by device and browser.';
    }
    if(!dialog.open)dialog.showModal();
  }
  if(standalone){banner.hidden=true;return;}
  if(ios||android){banner.hidden=false;button.textContent='Get the APLYNX App';}
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();promptEvent=event;banner.hidden=false;button.textContent='Install APLYNX App';
  });
  button.addEventListener('click',async()=>{
    if(promptEvent){
      const event=promptEvent;promptEvent=null;
      try{
        await event.prompt();
        const result=await event.userChoice;
        if(result&&result.outcome==='accepted'){banner.hidden=true;return;}
      }catch(_){}
    }
    openInstructions();
  });
  close?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  copy?.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText('https://www.aplynxinvestments.com/');copy.textContent='Link copied!';}
    catch(_){copy.textContent='aplynxinvestments.com';}
  });
  window.addEventListener('appinstalled',()=>{banner.hidden=true;promptEvent=null;if(dialog.open)dialog.close();});
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{}));
})();
