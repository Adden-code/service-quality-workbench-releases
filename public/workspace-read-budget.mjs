// Bound cold-load cost by advertised bytes. Writes keep their idempotency and
// conflict rules; this budget only covers reading the immutable response.
export function workspaceReadBudget(bytes=0,minimum=30000){
 const size=Number(bytes);
 return Math.min(180000,Math.max(minimum,30000+(Number.isFinite(size)&&size>0?Math.ceil(size/1048576)*1500:0)));
}
export function workspaceRecoveryDelay(attempt){return Math.min(30000,1500*2**Math.min(Math.max(0,attempt),5));}
