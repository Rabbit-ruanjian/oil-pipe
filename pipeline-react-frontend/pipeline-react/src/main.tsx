import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './index.css';

const browserGlobal = globalThis as typeof globalThis & { global?: typeof globalThis };

if (typeof browserGlobal.global === 'undefined') {
  Object.defineProperty(browserGlobal, 'global', {
    value: browserGlobal,
    configurable: true,
    writable: true,
  });
}

interface BootErrorBoundaryState {
  error: Error | null;
}

class BootErrorBoundary extends Component<{ children: ReactNode }, BootErrorBoundaryState> {
  state: BootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <BootErrorScreen error={this.state.error} />;
    }

    return this.props.children;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

function BootErrorScreen({ error }: { error: unknown }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#f8fafc',
        color: '#0f172a',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 900,
          background: '#ffffff',
          border: '1px solid rgba(15, 23, 42, 0.08)',
          borderRadius: 16,
          boxShadow: '0 20px 40px rgba(15, 23, 42, 0.08)',
          padding: 24,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24 }}>Frontend startup failed</h1>
        <p style={{ margin: '12px 0 0', color: '#475569' }}>
          The page did not finish bootstrapping. The captured browser error is shown below.
        </p>
        <pre
          style={{
            margin: '20px 0 0',
            padding: 16,
            borderRadius: 12,
            background: '#0f172a',
            color: '#e2e8f0',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {getErrorMessage(error)}
        </pre>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element "#root" was not found.');
}

const root = createRoot(rootElement);
let fatalRendered = false;

function renderFatal(error: unknown, targetRoot: Root) {
  if (fatalRendered) {
    return;
  }

  fatalRendered = true;
  targetRoot.render(<BootErrorScreen error={error} />);
}

window.addEventListener('error', (event) => {
  renderFatal(event.error ?? new Error(event.message), root);
});

window.addEventListener('unhandledrejection', (event) => {
  renderFatal(event.reason, root);
});

void import('./App.tsx')
  .then(({ default: App }) => {
    if (fatalRendered) {
      return;
    }

    root.render(
      <StrictMode>
        <BootErrorBoundary>
          <App />
        </BootErrorBoundary>
      </StrictMode>,
    );
  })
  .catch((error) => {
    renderFatal(error, root);
  });
