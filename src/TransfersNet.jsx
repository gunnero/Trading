import React,{useEffect,useState} from 'react';
import './transfers.css';
import {apiFetch} from './auth-client';
import {moneyText} from './data/transfers.mjs';
export default function TransfersNet({onOpen}){
 const [summary,setSummary]=useState(null);
 useEffect(()=>{let alive=true;const read=async()=>{try{const response=await apiFetch('/api/transfers/summary');if(!response.ok)throw Error();const value=await response.json();if(alive)setSummary(value);}catch{if(alive)setSummary(null);}};read();window.addEventListener('opening-bell:transfers-updated',read);const timer=setInterval(read,60000);return()=>{alive=false;window.removeEventListener('opening-bell:transfers-updated',read);clearInterval(timer);};},[]);
 const negative=summary?.net.startsWith('-'),positive=summary&&summary.net!=='0'&&!negative;
 return <button className={`sidebar-transfer-net ${negative?'negative':positive?'positive':''}`} onClick={onOpen}><span>Trading net · USD</span><strong>{summary?`${negative?'−':positive?'+':''}${moneyText(summary.net.replace('-',''),'USD')}`:'—'}</strong><small>{summary?'Returns received minus costs & funding':'Net amount unavailable'}</small></button>;
}
