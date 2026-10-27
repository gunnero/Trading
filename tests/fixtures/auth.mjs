// Test-only session provisioning. Production has no bypass or fixture route.
export async function authenticateTestPage(page){
  const value=process.env.OPENING_BELL_TEST_SESSION,url=process.env.OPENING_BELL_TEST_ORIGIN;
  if(value&&url)await page.context().addCookies([{name:'ob_local_session',value,url,httpOnly:true,sameSite:'Strict'}]);
}
export function testFetch(input,options={}){
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),headers=new Headers(options.headers);
  if(url.origin===process.env.OPENING_BELL_TEST_ORIGIN&&process.env.OPENING_BELL_TEST_SESSION){
    if(!headers.has('Cookie'))headers.set('Cookie','ob_local_session='+process.env.OPENING_BELL_TEST_SESSION);
    if(!['GET','HEAD'].includes((options.method||'GET').toUpperCase())){
      if(!headers.has('Origin'))headers.set('Origin',url.origin);
      if(!headers.has('X-CSRF-Token'))headers.set('X-CSRF-Token',process.env.OPENING_BELL_TEST_CSRF);
    }
  }
  return fetch(input,{...options,headers});
}
