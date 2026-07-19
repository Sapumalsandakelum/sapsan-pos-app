import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-rose-50 flex flex-col justify-center items-center p-6 font-sans">
          <div className="bg-white p-8 rounded-3xl border border-rose-200 shadow-xl max-w-2xl w-full text-center space-y-6">
            <div className="text-5xl">🚨</div>
            <h1 className="text-2xl font-black text-rose-700">Application Error Detected</h1>
            <p className="text-gray-600 text-sm">
              An unexpected error occurred in this section of the app. Please copy the error details below to help us diagnose and fix the issue.
            </p>
            <div className="bg-rose-950 text-rose-200 p-4 rounded-xl text-left font-mono text-xs overflow-x-auto whitespace-pre-wrap max-h-48 border border-rose-800">
              <strong className="block text-rose-400 mb-1">Error message:</strong>
              {this.state.error && this.state.error.toString()}
              {this.state.errorInfo && (
                <>
                  <strong className="block text-rose-400 mt-3 mb-1">Stack Trace:</strong>
                  {this.state.errorInfo.componentStack}
                </>
              )}
            </div>
            <div className="flex justify-center space-x-4">
              <button 
                onClick={() => window.location.reload()} 
                className="bg-rose-600 hover:bg-rose-700 text-white font-black text-xs px-6 py-2.5 rounded-xl shadow-md transition"
              >
                🔄 Reload App
              </button>
              <button 
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })} 
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-xs px-6 py-2.5 rounded-xl transition"
              >
                ◀️ Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
