import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#0e1117', color:'#e2e8f0', fontFamily:'monospace', padding:'1rem', textAlign:'center' }}>
          <p style={{ fontSize:'2rem', marginBottom:'0.5rem' }}>⚠️</p>
          <p style={{ fontSize:'1rem', marginBottom:'1rem' }}>Something went wrong loading the game.</p>
          <pre style={{ fontSize:'0.7rem', color:'#f87171', maxWidth:'90vw', overflowX:'auto', whiteSpace:'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop:'1.5rem', padding:'0.6rem 1.5rem', background:'#22c55e', color:'#000', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:'bold' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
