const {chromium}=require('playwright-core');
const fs=require('fs');
(async()=>{
  const FPS=25, DUR=12.0, N=Math.round(FPS*DUR);
  fs.rmSync('frames',{recursive:true,force:true}); fs.mkdirSync('frames');
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args:['--no-sandbox','--font-render-hinting=none','--force-color-profile=srgb']});
  const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  await p.goto('file://'+process.cwd()+'/reel.html',{waitUntil:'networkidle'});
  try{await p.evaluate(()=>document.fonts.ready);}catch(e){}
  await p.waitForTimeout(600);
  for(let i=0;i<N;i++){
    await p.evaluate(t=>window.seek(t), i/FPS);
    await p.screenshot({path:'frames/f'+String(i).padStart(4,'0')+'.png'});
  }
  await b.close();
  console.log('frames:',N);
})();
