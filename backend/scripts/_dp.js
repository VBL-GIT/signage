require('dotenv').config();
const API='https://signage-api-xsab.onrender.com';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let t=null;
async function login(){const r=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})});
  if(r.status!==200)return null;t=(await r.json()).access_token;return t;}
(async()=>{
 const deadline=Date.now()+25*60*1000;let n=0;
 while(Date.now()<deadline){
  n++;
  if(!t&&!await login()){console.log('  #'+n+' login unavailable');await sleep(60000);continue;}
  const r=await fetch(API+'/api/stores',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({})});
  if(r.status===401){t=null;continue;}
  const j=await r.json().catch(()=>({}));
  const keys=j.details?Object.keys(j.details):[];
  // OLD build: uid is required -> appears in the errors. NEW build: it does not.
  const isNew=keys.length>0&&!keys.includes('uid');
  console.log('  ['+new Date().toISOString().slice(11,19)+'] #'+n+' store errors: ['+keys.join(',')+'] -> '+(isNew?'NEW':'old'));
  if(isNew){console.log('\n  *** DEPLOY COMPLETE — Customer Code merge is live ***');process.exit(0);}
  await sleep(45000);
 }
 console.log('\n  STILL OLD after 25 minutes.');process.exit(1);
})();
