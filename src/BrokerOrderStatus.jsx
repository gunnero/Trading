import {ChartPieSlice,CheckCircle,Clock,Question,XCircle} from '@phosphor-icons/react';
import './broker-order-states.css';

const states={
  Pending:['pending',Clock], Cancelling:['pending',Clock], Replacing:['pending',Clock],
  'Partially filled':['partial',ChartPieSlice], Filled:['filled',CheckCircle],
  Rejected:['rejected',XCircle], Cancelled:['neutral',XCircle], Replaced:['neutral',CheckCircle],
  Reviewed:['neutral',CheckCircle],
};
function statusStyle(label){return Object.hasOwn(states,label)?states[label]:['neutral',Question];}
export function statusTone(label){return statusStyle(label)[0];}
export function BrokerStatus({label}){
  const [tone,Icon]=statusStyle(label);
  return <span className="broker-status" data-tone={tone}><Icon size={15} aria-hidden="true"/>{label||'Unknown'}</span>;
}
