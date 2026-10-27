import {readdir,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {parseJournalImport} from '../src/data/journal.mjs';

// Private, local import staging. Mounted after the same owner gate as workspace APIs.
// Reading a draft does not add a trade or modify the saved workspace.
export function journalDraftsMiddleware(directory){
  return async(req,res,next)=>{
    if(new URL(req.url,'http://localhost').pathname!=='/api/journal/drafts')return next();
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='GET'){res.writeHead(405,{Allow:'GET'});res.end(JSON.stringify({message:'Use GET.'}));return;}
    try{
      const folder=join(directory,'journal-drafts');let names;
      try{names=await readdir(folder);}catch(e){if(e.code!=='ENOENT')throw e;names=[];}
      const drafts=[];let unavailable=0;
      for(const name of names.filter(n=>/^[a-zA-Z0-9_-]+\.json$/.test(n)).sort().slice(-20)){
        try{const path=join(folder,name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>500000)throw Error();const draft=parseJournalImport(await readFile(path,'utf8'));drafts.push({id:name.slice(0,-5),...draft});}catch{unavailable++;}
      }
      res.end(JSON.stringify({drafts,...(unavailable?{message:'A prepared import could not be read. Its original file is unchanged.'}:{})}));
    }catch{res.statusCode=500;res.end(JSON.stringify({message:'Prepared imports are unavailable. Manual entry and file import still work.'}));}
  };
}
