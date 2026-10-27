let csrf=null;
export const setSessionToken=value=>{csrf=value||null;};
export const sessionToken=()=>csrf;
export function sessionExpired(){csrf=null;if(typeof window!=='undefined')window.dispatchEvent(new Event('opening-bell:session-expired'));}
export async function apiFetch(url,options={}){
  if(!csrf){const error=new Error('Sign in again to continue. Your unsaved edits remain in this tab.');error.auth=true;throw error;}
  const requestSession=csrf;
  const headers=new Headers(options.headers);
  if(!['GET','HEAD'].includes((options.method||'GET').toUpperCase()))headers.set('X-CSRF-Token',csrf);
  const response=await fetch(url,{...options,headers,credentials:'same-origin',cache:'no-store'});
  if(response.status===401){if(csrf===requestSession)sessionExpired();const error=new Error('Your session expired. Sign in again; your unsaved edits remain in this tab.');error.auth=true;throw error;}
  return response;
}
export async function authRequest(action,data){
  const response=await fetch('/api/auth/'+action,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web',...(csrf?{'X-CSRF-Token':csrf}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(20000)});
  let result;try{result=await response.json();}catch{throw Error('The account service is unavailable. Please try again.');}
  if(!response.ok)throw Error(result.message||'The account request failed.');return result;
}
