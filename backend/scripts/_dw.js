/* Deploy probe: POST /api/stores with an empty body. Both builds reject it;
   only the new one lists HOS among the errors. Creates nothing. */
require('dotenv').config();
const API='https://signage-api-xsab.onrender.com';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let T=null,tAt=0;
async function login(){const r=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})});if(r.status!==200)return null;T=(await r.json()).access_token;tAt=Date.now();return T;}
(async()=>{
 const deadline=Date.now()+45*60*1000;let n=0;
 while(Date.now()<deadline){
  n++;
  if(!T||Date.now()-tAt>12*60*1000){if(!await login()){console.log('  #'+n+' login unavailable');await sleep(60000);continue;}}
  const r=await fetch(API+'/api/stores',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify({customer_code:'zz',name:'zz',pincode:'1',lat:1,long:1,contact_email:'a@b.com'})});
  if(r.status===401){T=null;continue;}
  const j=await r.json().catch(()=>({}));
  const txt=JSON.stringify(j);
  const isNew=/HOS/.test(txt);
  console.log('  ['+new Date().toISOString().slice(11,19)+'] #'+n+' -> '+(isNew?'NEW':'old')+'  '+txt.slice(0,90));
  if(isNew){console.log('\n  *** RENDER DEPLOY COMPLETE ***');process.exit(0);}
  await sleep(45000);
 }
 console.log('\n  still old after 45 min');process.exit(1);
})();
