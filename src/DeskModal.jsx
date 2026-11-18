import {useEffect,useId,useRef} from 'react';
import {X} from '@phosphor-icons/react';

export function Modal({title,subtitle,children,onClose,wide=false,className='',initialFocus}) {
  const ref=useRef(null);
  const titleId=useId();
  useEffect(()=>{
    const dialog=ref.current;
    const trigger=document.activeElement;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    if(!dialog.open)dialog.showModal();
    if(initialFocus)dialog.querySelector(initialFocus)?.focus({preventScroll:true});
    return ()=>{
      if(dialog.open)dialog.close();
      document.body.style.overflow=previousOverflow;
      if(trigger instanceof HTMLElement && trigger.isConnected)trigger.focus({preventScroll:true});
    };
  },[]);

  function cancel(event){
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }
  return <dialog ref={ref} className={`modal ${wide?'wide':''} ${className}`} aria-labelledby={titleId}
    onCancel={cancel} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="modal-inner">
      <header className="modal-header">
        <div><h2 id={titleId}>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={22}/></button>
      </header>
      {children}
    </div>
  </dialog>;
}
