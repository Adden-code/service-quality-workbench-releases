import assert from 'node:assert/strict';
import {createArkClient} from '../../../../server/ark-client.mjs';

// This test consumes fictional envelopes produced by the actual Java ChatClient.
// The injected transport returns them from memory and cannot make network calls.
let source = '';
for await (const chunk of process.stdin) source += chunk.toString('utf8');
const [completed, truncated] = JSON.parse(source);
const input = {
  config: {apiKey: 'fictional-contract-key', model: 'fictional-model'},
  session: {id: 'fictional-session', turns: [{id: 1, role: '客服', text: 'Fictional source'}]},
  basis: {rules: [{id: 'FICTIONAL-R1', policyIds: [], passCriteria: 'Fictional pass', failCriteria: 'Fictional fail', exceptionCriteria: 'Fictional unknown'}], policies: []}
};
const client = envelope => createArkClient({fetchImpl: async () => new Response(JSON.stringify(envelope), {status: 200, headers: {'Content-Type': 'application/json'}})});
const result = await client(completed).inspect(input);
assert.equal(completed.choices[0].finish_reason, 'stop');
assert.equal(result.modelId, 'fictional-model');
assert.equal(result.requestId, 'fictional-completion-1');
assert.deepEqual(result.usage, {prompt_tokens: 7, completion_tokens: 4, total_tokens: 11});
assert.equal(result.results[0].ruleId, 'FICTIONAL-R1');
assert.equal(result.results[0].verdict, '符合');
assert.doesNotMatch(JSON.stringify(result), /reasoning|FICTIONAL_PRIVATE_REASONING/);
assert.equal(truncated.choices[0].finish_reason, 'length');
await assert.rejects(client(truncated).inspect(input), error => error.code === 'OUTPUT_TRUNCATED');
console.log('Java ChatClient envelopes accepted by original Node Ark parser; truncation classified.');
