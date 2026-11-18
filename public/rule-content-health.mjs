// Detect incomplete legacy NP content; never rewrite frozen task evidence.
export function newProductContentGaps(basis){
 const rules=basis?.rules||[], gaps=[];
 const rule=id=>rules.find(r=>r.id===id);
 const probing=rule('NP-R13');
 if(probing&&!['①','②','③','④','⑤','⑥','⑦','⑧'].every(n=>probing.exceptionCriteria?.includes(n)))gaps.push('NP-R13 探需八场景例外表');
 for(const id of ['NP-R15','NP-R16','NP-R17'])if(rule(id)&&!rule(id).scope?.includes('售前'))gaps.push(`${id} 销售阶段适用范围`);
 if(rule('NP-R17')&&!/维修/.test(rule('NP-R17').exceptionCriteria||''))gaps.push('NP-R17 售后维修不适用例外');
 return gaps;
}
