export {deliveryUnitProgress} from '../public/delivery-progress.mjs';
// A finished job with unfinished checkpoints is incomplete, never a successful
// skip. Project this read-only; adopting/retrying it is an explicit user action.
export function projectIncompleteDelivery(job){
 if(!['completed','completed_with_warnings'].includes(job.status))return job;
 for(const unit of job.units)if(['pending','running'].includes(unit.status)){
  unit.status='failed';unit.errorCode='incomplete_checkpoint';unit.error='该节点没有已完成的保存结果，请点击“重试缺失项”。';job.status='completed_with_warnings';
 }
 return job;
}
export function adoptIncompleteDelivery(job,view){
 for(const unit of job.units){const checked=view.units.find(item=>item.id===unit.id);if(checked?.errorCode==='incomplete_checkpoint'&&['pending','running'].includes(unit.status)){unit.status='failed';unit.errorCode=checked.errorCode;unit.error=checked.error;}}
}
