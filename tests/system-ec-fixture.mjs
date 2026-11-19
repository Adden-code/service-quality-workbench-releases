import {createEcommerceSample as legacySample} from '../public/ecommerce-sample.mjs';
import {readXlsx,workbook} from '../public/io.mjs';
import {SYSTEM_EC_HEADERS} from '../public/ecommerce-system-source.mjs';
export async function createEcommerceSample(){const old=await readXlsx(await legacySample());return workbook([{name:'Sheet4',headers:SYSTEM_EC_HEADERS,rows:old.Sheet4.slice(2).map(raw=>{const r=Array(23).fill('');for(const [a,b]of [[4,0],[5,1],[6,2],[7,3],[8,5],[9,6],[10,7],[11,8],[12,9],[13,16]])r[b]=raw[a];r[4]='VMALL-MX-HWB2C';return r;})}]);}
