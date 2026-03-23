import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { WorkspaceCanvas } from './components/WorkspaceCanvas'
import { DesignBar } from './components/DesignBar'
import { HelpModal } from './components/HelpModal'
import { ShortcutListModal } from './components/ShortcutListModal'
import { PiecePropertiesModal } from './components/PiecePropertiesModal'

export default function App() {
  return (
    <div className="app">
      <Toolbar />
      <div className="app-body">
        <Sidebar />
        <main className="workspace-wrap">
          <WorkspaceCanvas />
        </main>
      </div>
      <DesignBar />
      <HelpModal />
      <ShortcutListModal />
      <PiecePropertiesModal />
    </div>
  )
}
