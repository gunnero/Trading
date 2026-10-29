import {createContext,useContext,useMemo} from 'react';
import {createDisplayTime,DEFAULT_DISPLAY_TIME} from './data/display-time.mjs';
const DisplayTimeContext=createContext(createDisplayTime(DEFAULT_DISPLAY_TIME));
export function DisplayTimeProvider({workspace,children}){
  const {timeZone=DEFAULT_DISPLAY_TIME.timeZone,hourCycle=DEFAULT_DISPLAY_TIME.hourCycle}=workspace.data?.displayTime||{};
  const value=useMemo(()=>createDisplayTime({timeZone,hourCycle}),[timeZone,hourCycle]);
  return <DisplayTimeContext.Provider value={value}>{children}</DisplayTimeContext.Provider>;
}
export const useDisplayTime=()=>useContext(DisplayTimeContext);
