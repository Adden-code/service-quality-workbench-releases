import fs from 'node:fs/promises';
import path from 'node:path';
import {validateCatalog} from '../public/catalog.mjs';

/** A catalog seed is a directory, never a serialized user workspace. */
export function validateCatalogSeed(input){
 const allowed=['schemaVersion','rules','policies','events','ruleSets'];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('目录种子只能包含规则、政策资料和空事件目录。');
 const forbidden=new Set(['apiKey','apiKeyCiphertext','credentials','secrets','password','accessToken','refreshToken','sessions','tasks','mutations']);
 const inspect=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(key==='provenance')throw new Error('目录种子不得包含 provenance 来源依赖。');if(forbidden.has(key))throw new Error('目录种子不得包含任务、会话或凭据。');inspect(item);}};inspect(input);
 validateCatalog(input);
 if(input.events.length||[...input.rules,...input.policies,...(input.ruleSets||[])].some(record=>record.status!=='已发布'))throw new Error('目录种子只允许已发布版本，events 必须为空。');
 return structuredClone(input);
}

export async function loadBundledCatalogSeed(resourcesDir){
 let raw;try{const directory=await fs.lstat(resourcesDir);if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error('目录种子资源须为普通目录，不允许链接。');const file=path.join(resourcesDir,'catalog-seed.json'),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('目录种子须为普通文件，不允许链接。');if(stat.size>8*1024*1024)throw new Error('目录种子超出8MB。');raw=await fs.readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
 try{return validateCatalogSeed(JSON.parse(raw.replace(/^\uFEFF/,'')));}catch(error){throw new Error(`预置目录种子无效：${error.message}`);}
}
