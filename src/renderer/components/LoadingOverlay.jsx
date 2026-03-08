import useAppStore from '../stores/useAppStore';

export default function LoadingOverlay() {
  const isLoading = useAppStore((s) => s.isLoading);
  const loadingText = useAppStore((s) => s.loadingText);

  if (!isLoading) return null;

  return (
    <div className="loading-overlay" style={{ display: 'flex' }}>
      <div className="loading-spinner" />
      <div className="loading-text">{loadingText}</div>
    </div>
  );
}
