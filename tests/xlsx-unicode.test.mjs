import test from 'node:test';
import assert from 'node:assert/strict';
import {workbook,readXlsx} from '../public/io.mjs';

test('XLSX writer preserves supplementary Unicode at zip string chunk boundaries',async()=>{
 const value='🙂'.repeat(15000);
 for(const header of ['A','AA']){
  const tables=await readXlsx(await workbook([{name:'Unicode原文',headers:[header],rows:[[value],[value],[value]]}]));
  assert.ok(tables['Unicode原文'].slice(1).every(row=>row[0]===value),'Every Unicode source character must survive the XLSX roundtrip.');
 }
});
