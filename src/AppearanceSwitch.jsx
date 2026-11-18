import {Moon, Sun} from '@phosphor-icons/react';
import {setAppearance, useAppearance} from './appearance';

export function AppearanceSwitch() {
  const dark = useAppearance() === 'dark';
  const Icon = dark ? Moon : Sun;
  return <button className="nav-item appearance-switch" type="button" role="switch" aria-checked={dark}
    onClick={() => setAppearance(dark ? 'light' : 'dark')}>
    <Icon size={16} aria-hidden="true"/><span>Dark mode</span><i aria-hidden="true"/>
  </button>;
}
