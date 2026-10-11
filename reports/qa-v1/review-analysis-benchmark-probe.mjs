import fs from 'node:fs';
import {createHash} from 'node:crypto';
const append=fs.appendFileSync;
fs.appendFileSync=function(target,...args) {
  const actual=String(target).replace('/frontend/src/lookupApi.ts','/frontend/src/api/lookupApi.ts');
  const h=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const before={target:String(target),targetExisted:fs.existsSync(target),actualApiPath:actual,actualApiHash:h(actual)};
  const result=append.call(this,target,...args);
  fs.writeFileSync('/workspace/review-analysis-deliverables/qa-v1/benchmark-probe.json',JSON.stringify({...before,targetNowExists:fs.existsSync(target),actualApiHashAfter:h(actual),targetText:fs.readFileSync(target,'utf8')},null,2)+'\n');
  return result;
};
