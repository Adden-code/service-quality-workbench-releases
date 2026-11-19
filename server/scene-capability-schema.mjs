// JSON mode is portable across OpenAI-compatible intranet gateways. The complete
// schema accompanies the prompt; local validation remains authoritative even if
// the provider ignores constraints. Never claim remote field-level enforcement.
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string={type:'string'};
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
export function sceneCapabilitySchema(input){
 const quote=object({blockId:string,quote:string,start:{type:'integer',minimum:0},end:{type:'integer',minimum:1}});
 const evidence={type:'array',items:quote,maxItems:100};
 const ref=nullable(object({blockId:string,timestampQuote:string}));
 const shapes={
  ecommerceClassification:object({polarity:{enum:['positive','negative','invalid']},vocKind:{enum:['substantive','strong-negative','none']}}),
  site:object({siteId:{enum:(input.sites||[]).map(s=>s.id)}}),
  intent:object({labelId:{enum:(input.taxonomy?.labels||[]).filter(l=>l.parentId).map(l=>l.id)}}),
  demandSummary:object({text:string}),negativeVoice:object({hasNegative:{type:'boolean'},text:string}),
  translation:object({detectedLanguage:{enum:['zh','en','other']},text:string}),
  timing:object({firstCustomer:ref,firstAgent:ref,queries:{type:'array',maxItems:200,items:object({issueId:string,topic:string,start:ref,end:ref,evidence})},completeCoverage:{const:true}})
 };
 if(!shapes[input.capability])throw Object.assign(new Error('未知辅助能力。'),{code:'INVALID_INPUT'});
 const schema=object({status:{enum:['completed','uncertain']},value:nullable(shapes[input.capability]),confidence:{type:'number',minimum:0,maximum:1},reason:string,evidence});
 if(input.capability==='ecommerceClassification'){shapes.ecommerceClassification.allOf=[{if:{properties:{polarity:{enum:['positive','invalid']}}},then:{properties:{vocKind:{const:'none'}}}}];schema.allOf=[{if:{properties:{status:{const:'uncertain'}}},then:{properties:{value:{type:'null'}}}}];}
 return schema;
}
