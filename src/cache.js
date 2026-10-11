import fs from 'node:fs';
import path from 'node:path';
import {hash} from './snapshot.js';
export function cacheStore(directory, stats) {
  return {
    get(key) {
      if (!directory) return null;
      try {
        const entry=JSON.parse(fs.readFileSync(path.join(directory,key+'.json'),'utf8'));
        if(entry.key!==key||entry.digest!==hash(entry.value)) throw new Error('Invalid cache digest');
        return entry.value;
      } catch(error) {if(error.code!=='ENOENT') stats.invalidEntries++;return null;}
    },
    set(key,value) {
      if (!directory) return;
      fs.mkdirSync(directory,{recursive:true});
      const target=path.join(directory,key+'.json'); const temporary=target+`.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(temporary,JSON.stringify({key,digest:hash(value),value}));
      fs.renameSync(temporary,target);
    }
  };
}
