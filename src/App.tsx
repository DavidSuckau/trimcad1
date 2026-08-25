import { lazy, Suspense } from 'react'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { WorkspaceCanvas } from './components/WorkspaceCanvas'
import { DesignBar } from './components/DesignBar'
import { HelpModal } from './components/HelpModal'
import { ShortcutListModal } from './components/ShortcutListModal'
import { PiecePropertiesModal } from './components/PiecePropertiesModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SEAT_3D_PREVIEW_ENABLED } from './seat3d/featureFlags'
import { DEV_FEEDBACK_ENABLED } from './devFeedback/featureFlags'

const Scan3dModal = lazy(() => import('./components/Scan3dModal').then((m) => ({ default: m.Scan3dModal })))
const Seat3dModal = lazy(() =>
  import('./seat3d/Seat3dModal').then((m) => ({ default: m.Seat3dModal })),
)
const DevFeedbackModal = lazy(() =>
  import('./devFeedback/DevFeedbackModal').then((m) => ({ default: m.DevFeedbackModal })),
)

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
          </main>
        </div>
        <DesignBar />
        <HelpModal />
        <ShortcutListModal />
        <PiecePropertiesModal />
        <Suspense fallback={null}>
          <Scan3dModal />
          {SEAT_3D_PREVIEW_ENABLED ? <Seat3dModal /> : null}
          {DEV_FEEDBACK_ENABLED ? <DevFeedbackModal /> : null}
        </Suspense>
      </div>
    </ErrorBoundary>
  )
}
