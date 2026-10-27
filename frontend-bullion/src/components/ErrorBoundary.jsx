import { Component } from 'react';

// Catches any crash anywhere in the app and shows it directly on the page
// instead of leaving a blank screen — this makes debugging on a real
// deployed site possible without needing DevTools timing tricks.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('App crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', background: '#fff', color: '#111',
          fontFamily: 'monospace', padding: '32px', whiteSpace: 'pre-wrap',
          wordBreak: 'break-word', fontSize: 14, lineHeight: 1.6,
        }}>
          <h1 style={{ color: '#c04840', fontSize: 20, marginBottom: 16 }}>⚠ App crashed — here's why:</h1>
          <div style={{ background: '#fee', border: '1px solid #c04840', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <strong>{this.state.error?.name || 'Error'}:</strong> {this.state.error?.message || String(this.state.error)}
          </div>
          <details open style={{ background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 8, padding: 16 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: 8 }}>Full stack trace</summary>
            <div style={{ marginTop: 12 }}>{this.state.error?.stack}</div>
            {this.state.info?.componentStack && (
              <>
                <hr style={{ margin: '16px 0' }} />
                <div><strong>Component stack:</strong>{this.state.info.componentStack}</div>
              </>
            )}
          </details>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, padding: '10px 20px', borderRadius: 8, border: 'none', background: '#c9a227', fontWeight: 'bold', cursor: 'pointer' }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
