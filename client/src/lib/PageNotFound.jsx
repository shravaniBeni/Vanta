import { useLocation } from 'react-router-dom';

export default function PageNotFound() {
  const location = useLocation();
  const pageName = location.pathname.substring(1);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#080c14]">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-7xl font-light text-slate-700">404</h1>
        <div className="h-0.5 w-16 bg-slate-800 mx-auto" />
        <div className="space-y-3">
          <h2 className="text-2xl font-medium text-slate-300">Page Not Found</h2>
          <p className="text-slate-500 leading-relaxed">
            The page <span className="font-medium text-slate-400">"{pageName}"</span> does not exist.
          </p>
        </div>
        <button
          onClick={() => window.location.href = '/'}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-300 bg-[#0d1117] border border-indigo-500/20 rounded-lg hover:border-indigo-500/40 transition-colors"
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
