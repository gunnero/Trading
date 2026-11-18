import {DownloadSimple,Warning} from '@phosphor-icons/react';
import {Modal} from './DeskModal';

export function WorkspaceConflict({workspace,onClose}){
  return <Modal title="Your workspace changed" className="edit-dialog confirm-dialog" initialFocus=".download-edits" onClose={onClose}>
    <div className="confirmation-body">
      <span className="confirmation-icon warning"><Warning size={32}/></span>
      <h3>Save conflict</h3>
      <p>Another tab saved a newer version. Download your edits before replacing this tab’s copy.</p>
    </div>
    <div className="edit-footer">
      <button className="button outline download-edits" onClick={workspace.backup}><DownloadSimple size={17}/>Download edits</button>
      <button className="button primary" onClick={workspace.reload}>Load saved version</button>
    </div>
  </Modal>;
}
