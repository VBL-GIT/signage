/* Read-only deploy probe: uploads nothing, creates nothing.
   NEW build accepts a customer-master sheet without a `format` param, so the
   marker is the store bulk route reporting a fetch failure on a dummy URL
   rather than a schema rejection. Simpler tell: the Vercel template columns. */
const https=require('https');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function get(url){return new Promise((res,rej)=>{https.get(url,r=>{const c=[];r.on('data',d=>c.push(d));r.on('end',()=>res({status:r.statusCode,buf:Buffer.concat(c)}));}).on('error',rej);});}
(async()=>{
 const deadline=Date.now()+30*60*1000;let n=0;
 while(Date.now()<deadline){
  n++;
  const r=await get('https://signage-ruddy.vercel.app/templates/stores_template.xlsx?cb='+Date.now());
  // The xlsx stores shared strings as plain text inside the zip; look for the header.
  const txt=r.buf.toString('latin1');
  const isNew=txt.includes('Cust_CD')&&txt.includes('SUB_CHANNEL');
  console.log('  ['+new Date().toISOString().slice(11,19)+'] #'+n+' stores_template '+r.buf.length+'B -> '+(isNew?'NEW (Cust_CD present)':'old'));
  if(isNew){console.log('\n  *** VERCEL DEPLOY COMPLETE ***');process.exit(0);}
  await sleep(45000);
 }
 console.log('\n  still old after 30 min');process.exit(1);
})();
