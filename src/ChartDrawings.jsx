import {createContext,useContext,useEffect,useId,useRef,useState} from 'react';
import {Cursor,LineSegment,Minus,Rectangle,TextT,ArrowUUpLeft,ArrowUUpRight,Trash,Eye,EyeSlash} from '@phosphor-icons/react';
import {DRAWING_COLORS,MAX_DRAWINGS,timeIndex,indexTime} from './data/drawings.mjs';
import {useSavedChart} from './ChartSettings';

const DrawingContext=createContext(null),EMPTY=[];
const tools=[['select','Select',Cursor],['horizontal','Horizontal level',Minus],['trend','Trend line',LineSegment],['rectangle','Rectangle',Rectangle],['text','Text note',TextT]];
const toolName=type=>tools.find(t=>t[0]===type)?.[1]||type;
export function DrawingProvider({workspace,children}){
  const [history,setHistory]=useState({});
  function change(key,next,action='edit'){
    workspace.update(current=>{
      const before=current.chartDrawings?.[key]||EMPTY,stack=history[key]||{past:[],future:[]};
      let items=next,newStack;
      if(action==='undo'){
        if(!stack.past.length)return current;
        items=stack.past.at(-1);newStack={past:stack.past.slice(0,-1),future:[before,...stack.future].slice(0,30)};
      }else if(action==='redo'){
        if(!stack.future.length)return current;
        items=stack.future[0];newStack={past:[...stack.past,before].slice(-30),future:stack.future.slice(1)};
      }else{
        if(JSON.stringify(before)===JSON.stringify(items))return current;
        newStack={past:[...stack.past,before].slice(-30),future:[]};
      }
      setHistory(previous=>({...previous,[key]:newStack}));
      const chartDrawings={...current.chartDrawings};
      if(items.length)chartDrawings[key]=items;else delete chartDrawings[key];
      return {...current,chartDrawings};
    });
  }
  // Loading another saved revision must not replay undo from the discarded edits.
  useEffect(()=>{if(workspace.status==='loading')setHistory({});},[workspace.status]);
  return <DrawingContext.Provider value={{items:workspace.data.chartDrawings||{},history,change,status:workspace.status}}>{children}</DrawingContext.Provider>;
}

export function DrawingChart({scope,symbol,timeframe,times,instance,formatValue,top=5,bottom=68,children}){
  const store=useContext(DrawingContext),items=store?.items[scope]||EMPTY;
  const {config,set:saveConfig}=useSavedChart(scope),color=config.drawingColor,hidden=!config.drawingsVisible,open=config.panel==='drawings';
  const setColor=drawingColor=>saveConfig({drawingColor}),setHidden=hidden=>saveConfig({drawingsVisible:!hidden});
  const [tool,setTool]=useState('select'),[selected,setSelected]=useState(null),[draft,setDraft]=useState(null),[clear,setClear]=useState(false);
  const frame=useRef(null),selectedItem=items.find(item=>item.id===selected),stack=store?.history[scope];
  const remaining=Math.min(MAX_DRAWINGS-items.length,1000-Object.values(store?.items||{}).reduce((sum,list)=>sum+list.length,0),!items.length&&Object.keys(store?.items||{}).length>=300?0:Infinity);
  useEffect(()=>{setTool('select');setSelected(null);setDraft(null);setClear(false);},[scope]);
  useEffect(()=>{if(!open){setTool('select');setSelected(null);setDraft(null);setClear(false);}},[open]);
  const commit=next=>store?.change(scope,next);
  const choose=next=>{setTool(next);setDraft(null);setHidden(false);setClear(false);setSelected(null);};
  const remove=()=>{commit(items.filter(item=>item.id!==selected));setSelected(null);};
  const updateSelected=patch=>{if(selectedItem)commit(items.map(item=>item.id===selected?{...item,...patch}:item));};
  const select=id=>{setSelected(id);setTool('select');setHidden(false);setDraft(null);if(!open)saveConfig({panel:'drawings'});};
  const focusChart=()=>frame.current?.querySelector('.price-chart')?.focus({preventScroll:true});
  function keydown(event){
    if(event.target.closest('input,textarea,select'))return;
    if(event.key==='Escape'&&(tool!=='select'||draft||selected||clear)){event.preventDefault();event.stopPropagation();choose('select');}
    else if((event.key==='Delete'||event.key==='Backspace')&&selectedItem){event.preventDefault();event.stopPropagation();remove();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){
      event.preventDefault();event.stopPropagation();setDraft(null);store?.change(scope,null,event.shiftKey?'redo':'undo');
    }
  }
  const instruction=hidden?'Drawings hidden. Show them to edit.':remaining<=0?'Drawing limit reached. Remove a drawing to add another.':tool==='select'?'Select a drawing to move it; drag its handles to resize.':tool==='horizontal'?'Click or tap the plot to place a price level.':tool==='text'?'Click or tap the plot to place a note, then edit its text.':draft?'Choose the second point. Esc cancels.':'Click or tap two points on the plot. Esc cancels.';
  const unavailable=items.filter(item=>item.type!=='horizontal'&&item.points.some(p=>timeIndex(times,p.time)===null)).length;
  return <div className="drawing-chart" onKeyDownCapture={keydown}>
    {open&&<><div className="drawing-toolbar" role="group" aria-label="Chart drawing tools">
      <span className="drawing-title">Draw</span>
      <div className="drawing-tool-group">{tools.map(([id,label,Icon])=><button key={id} type="button" title={label} aria-label={label} aria-pressed={tool===id} disabled={!store||(remaining<=0&&id!=='select')} onClick={()=>choose(id)}><Icon size={17}/><span>{id==='horizontal'?'Level':id==='trend'?'Trend':id==='text'?'Note':label}</span></button>)}</div>
      <label className="drawing-color-label"><span className="sr-only">Drawing color</span><select aria-label="Drawing color" value={selectedItem?.color||color} style={{color:selectedItem?.color||color}} onChange={e=>{setColor(e.target.value);if(draft)setDraft({...draft,color:e.target.value});updateSelected({color:e.target.value});}}>{DRAWING_COLORS.map((value,i)=><option key={value} value={value}>{['Amber','Green','Red','Blue','White'][i]}</option>)}</select></label>
      <div className="drawing-tool-group drawing-actions">
        <button type="button" aria-label="Undo drawing" title="Undo drawing (Ctrl / ⌘ Z)" disabled={!stack?.past.length} onClick={()=>{setDraft(null);store.change(scope,null,'undo');}}><ArrowUUpLeft size={17}/></button>
        <button type="button" aria-label="Redo drawing" title="Redo drawing (Ctrl / ⌘ Shift Z)" disabled={!stack?.future.length} onClick={()=>{setDraft(null);store.change(scope,null,'redo');}}><ArrowUUpRight size={17}/></button>
        <button type="button" aria-label={hidden?'Show drawings':'Hide drawings'} title={hidden?'Show drawings':'Hide drawings'} aria-pressed={hidden} disabled={!items.length} onClick={()=>{setHidden(!hidden);setDraft(null);setTool('select');}}>{hidden?<EyeSlash size={17}/>:<Eye size={17}/>}</button>
        <button type="button" aria-label="Delete selected drawing" title="Delete selected drawing (Delete)" disabled={!selectedItem} onClick={remove}><Trash size={17}/></button>
      </div>
    </div>
    <div className="drawing-hint"><span role="status">{instruction}</span><span>{items.length}/{MAX_DRAWINGS} · {symbol} {timeframe} · {store?.status==='saved'?'Saved':store?.status==='pending'||store?.status==='saving'?'Saving…':'Not saved'}</span></div>
    {!!items.length&&<div className="drawing-selection">
      <select aria-label="Select drawing" value={selectedItem?.id||''} onChange={e=>select(e.target.value)}><option value="">Your drawings ({items.length})</option>{items.map((item,i)=><option value={item.id} key={item.id}>{i+1}. {toolName(item.type)} · {item.type==='text'?item.text:formatValue(item.points[0].price)}</option>)}</select>
      {selectedItem?.type==='text'&&<NoteEditor key={selectedItem.id+selectedItem.text} item={selectedItem} onSave={text=>updateSelected({text})}/>}
      {selectedItem?.type==='horizontal'&&<LevelEditor key={selectedItem.id+selectedItem.points[0].price} value={selectedItem.points[0].price} onSave={price=>updateSelected({points:[{...selectedItem.points[0],price}]})}/>}
      {selectedItem&&<span>{toolName(selectedItem.type)} · {selectedItem.points.map(p=>formatValue(p.price)).join(' → ')}</span>}
      {!clear?<button type="button" onClick={()=>setClear(true)}>Clear drawings</button>:<><span>Clear this chart’s {items.length} drawings?</span><button type="button" onClick={()=>{commit([]);setSelected(null);setDraft(null);setClear(false);}}>Clear this chart</button><button type="button" onClick={()=>setClear(false)}>Cancel</button></>}
    </div>}
    </>}{!!unavailable&&<p className="drawing-history-note">{unavailable} drawing{unavailable===1?' is':'s are'} outside the loaded history; saved anchors are retained.</p>}
    <div className="drawing-chart-frame" ref={frame} onPointerDownCapture={event=>{if(!event.target.closest('.drawing-overlay'))setSelected(null);}}>
      {children}
      <DrawingOverlay instance={instance} times={times} items={items} tool={tool} color={color} selected={selected} hidden={hidden} draft={draft} setDraft={setDraft} select={select} top={top} bottom={bottom} formatValue={formatValue} focusChart={focusChart} onCommit={item=>{commit([...items,item]);select(item.id);}} onEdit={item=>commit(items.map(old=>old.id===item.id?item:old))}/>
    </div>
  </div>;
}

function NoteEditor({item,onSave}){
  const [text,setText]=useState(item.text);
  const save=()=>{const next=text.trim();if(next&&next!==item.text)onSave(next);else setText(item.text);};
  return <input aria-label="Drawing note text" value={text} maxLength={120} onChange={e=>setText(e.target.value)} onBlur={save} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();save();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setText(item.text);}}}/>;
}

function LevelEditor({value,onSave}){
  const [text,setText]=useState(String(+value.toFixed(6)));
  function save(){const next=Number(text);if(text.trim()&&Number.isFinite(next)&&Math.abs(next)<=1e9&&next!==+value.toFixed(6))onSave(next);else setText(String(+value.toFixed(6)));}
  return <label>Price <input aria-label="Drawing level price" type="number" step="any" value={text} onChange={e=>setText(e.target.value)} onBlur={save} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();save();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setText(String(+value.toFixed(6)));}}}/></label>;
}

function DrawingOverlay({instance,times,items,tool,color,selected,hidden,draft,setDraft,select,top,bottom,formatValue,focusChart,onCommit,onEdit}){
  const [,redraw]=useState(0),[editing,setEditing]=useState(null),gesture=useRef(null),svg=useRef(null),clip=useId().replaceAll(':','');
  useEffect(()=>{
    if(!instance)return;let raf;
    const render=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>redraw(x=>x+1));};
    instance.on('rendered',render);render();
    return()=>{instance.off('rendered',render);cancelAnimationFrame(raf);};
  },[instance]);
  useEffect(()=>{gesture.current=null;setEditing(null);},[tool,hidden,times[0],times.at(-1)]);
  if(!instance||instance.isDisposed())return null;
  const width=instance.getWidth(),height=instance.getHeight(),left=10,right=width-68,base=height-bottom;
  const xy=point=>{
    const index=timeIndex(times,point.time);if(index===null)return null;
    return instance.convertToPixel({gridIndex:0},[index,point.price]);
  };
  function pointAt(event){
    const box=svg.current.getBoundingClientRect(),x=Math.max(left,Math.min(right,event.clientX-box.left)),y=Math.max(top,Math.min(base,event.clientY-box.top));
    const point=instance.convertFromPixel({gridIndex:0},[x,y]);
    if(!point?.every(Number.isFinite))return null;
    const index=Math.max(0,Math.min(times.length-1,point[0]));return {time:indexTime(times,index),price:point[1],index};
  }
  const anchor=point=>({time:point.time,price:point.price});
  function start(event){
    if(event.button!==0||event.isPrimary===false)return;
    event.preventDefault();event.stopPropagation();focusChart();
    const point=pointAt(event);if(!point)return;
    const target=event.target.closest('[data-drawing-id]'),item=target&&items.find(d=>d.id===target.dataset.drawingId);
    if(tool==='select'&&!item)return;
    if(item)select(item.id);
    gesture.current={id:event.pointerId,start:point,x:event.clientX,y:event.clientY,item,handle:event.target.dataset.handle,moved:false};
    svg.current.setPointerCapture(event.pointerId);
  }
  function move(event){
    const point=pointAt(event);if(!point)return;
    const g=gesture.current;
    if(!g){if(draft)setDraft({...draft,points:[draft.points[0],anchor(point)]});return;}
    if(g.id!==event.pointerId||!g.item)return;
    if(Math.hypot(event.clientX-g.x,event.clientY-g.y)<3&&!g.moved)return;
    g.moved=true;
    let points;
    if(g.handle!==undefined)points=g.item.points.map((p,i)=>i===Number(g.handle)?anchor(point):p);
    else{
      const indices=g.item.points.map(p=>timeIndex(times,p.time));
      const delta=indices.some(i=>i===null)?0:Math.max(-Math.min(...indices),Math.min(times.length-1-Math.max(...indices),point.index-g.start.index));
      points=g.item.points.map((p,i)=>({time:g.item.type==='horizontal'?p.time:indexTime(times,indices[i]+delta),price:p.price+point.price-g.start.price}));
    }
    const item={...g.item,points};g.edited=item;setEditing(item);
  }
  function finish(event){
    const g=gesture.current;if(!g||g.id!==event.pointerId)return;
    gesture.current=null;setEditing(null);if(svg.current.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);
    event.preventDefault();event.stopPropagation();
    if(g.item){if(g.edited)onEdit(g.edited);return;}
    const point=pointAt(event);if(!point)return;
    const item={id:crypto.randomUUID(),type:tool,color,points:[anchor(point)]};
    if(tool==='text'){onCommit({...item,text:'Note'});return;}
    if(tool==='horizontal'){onCommit(item);return;}
    if(!draft){setDraft({...item,points:[anchor(point),anchor(point)]});return;}
    if(Math.abs(point.time-draft.points[0].time)<1&&Math.abs(point.price-draft.points[0].price)<1e-8)return;
    onCommit({...draft,points:[draft.points[0],anchor(point)]});
  }
  const cancel=()=>{gesture.current=null;setEditing(null);};
  // Keep the selected handles reachable even when annotations overlap.
  const drawings=[...items.filter(item=>item.id!==selected),...items.filter(item=>item.id===selected)].map(item=>editing?.id===item.id?editing:item);
  function shape(item,preview=false){
    const pts=item.type==='horizontal'?[[left,instance.convertToPixel({yAxisIndex:0},item.points[0].price)]]:item.points.map(xy);
    if(pts.some(p=>!p||!p.every(Number.isFinite)))return null;
    const [[x,y],end]=pts,active=selected===item.id&&!preview,[x2,y2]=end||[x,y];
    const style={stroke:item.color,strokeWidth:active?2.5:1.7,fill:'none',pointerEvents:'none',strokeDasharray:preview?'5 4':undefined};
    const hit={stroke:'transparent',strokeWidth:18,fill:'none',pointerEvents:tool==='select'?'stroke':'none'};
    return <g key={item.id} data-drawing-id={item.id} data-drawing-type={item.type} data-selected={active} className="drawing-shape" style={{cursor:'move'}}>
      {item.type==='horizontal'?<><line x1={left} x2={right} y1={y} y2={y} {...style}/><line x1={left} x2={right} y1={y} y2={y} {...hit}/><text x={left+8} y={y-7} fill={item.color} className="drawing-level-label" pointerEvents="none">My level · {formatValue(item.points[0].price)}</text></>:
       item.type==='trend'?<><line x1={x} y1={y} x2={x2} y2={y2} {...style}/><line x1={x} y1={y} x2={x2} y2={y2} {...hit}/></>:
       item.type==='rectangle'?<rect x={Math.min(x,x2)} y={Math.min(y,y2)} width={Math.max(1,Math.abs(x2-x))} height={Math.max(1,Math.abs(y2-y))} {...style} fill={`${item.color}20`} pointerEvents={tool==='select'?'all':'none'}/>:
       <text x={x} y={y} fill={item.color} className="drawing-note" style={{pointerEvents:tool==='select'?'all':'none'}}>{item.text}</text>}
      {active&&tool==='select'&&pts.map(([px,py],i)=><g key={i}><circle cx={item.type==='horizontal'?(left+right)/2:px} cy={py} r={5} fill="#101a1f" stroke={item.color} strokeWidth={2} pointerEvents="none"/><circle data-handle={i} cx={item.type==='horizontal'?(left+right)/2:px} cy={py} r={12} fill="transparent" pointerEvents="all" style={{cursor:'crosshair'}}/></g>)}
    </g>;
  }
  return <svg ref={svg} className="drawing-overlay" width={width} height={height} aria-hidden="true" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    <defs><clipPath id={clip}><rect x={left} y={top} width={Math.max(0,right-left)} height={Math.max(0,base-top)}/></clipPath></defs>
    <g clipPath={`url(#${clip})`}>{!hidden&&drawings.map(item=>shape(item))}{!hidden&&draft&&shape(draft,true)}</g>
    {tool!=='select'&&!hidden&&<rect className="drawing-surface" x={left} y={top} width={Math.max(0,right-left)} height={Math.max(0,base-top)} fill="transparent" pointerEvents="all" style={{cursor:'crosshair'}}/>}
  </svg>;
}
