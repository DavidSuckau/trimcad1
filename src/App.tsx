import { lazy, Suspense } from 'react'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { WorkspaceCanvas } from './components/WorkspaceCanvas'
import { WorkspaceAiChatPanel } from './components/WorkspaceAiChatPanel'
import { DesignBar } from './components/DesignBar'
import { HelpModal } from './components/HelpModal'
import { ShortcutListModal } from './components/ShortcutListModal'
import { PiecePropertiesModal } from './components/PiecePropertiesModal'
import { ErrorBoundary } from './components/ErrorBoundary'

const Scan3dModal = lazy(() => import('./components/Scan3dModal').then((m) => ({ default: m.Scan3dModal })))

export default function App() {
  return (
    <ErrorBoundary>
      <div className="app">
        <Toolbar />
        <div className="app-body">
          <Sidebar />
          <main className="workspace-wrap">
            <ErrorBoundary>
              <WorkspaceCanvas />
            </ErrorBoundary>
            <WorkspaceAiChatPanel />
          </main>
        </div>
        <DesignBar />
        <HelpModal />
        <ShortcutListModal />
        <PiecePropertiesModal />
        <Suspense fallback={null}>
          <Scan3dModal />
        </Suspense>
      </div>
    </ErrorBoundary>
  )
}
