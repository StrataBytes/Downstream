import useAppStore from '../stores/useAppStore';

export default function CancelModal() {
  const { open, remainingCount } = useAppStore((s) => s.cancelModal);
  const closeCancelModal = useAppStore((s) => s.closeCancelModal);
  const setDownloadCancelled = useAppStore((s) => s.setDownloadCancelled);

  if (!open) return null;

  const handleConfirm = () => {
    setDownloadCancelled(true);
    closeCancelModal();
  };

  return (
    <div className="modal" style={{ display: 'block' }}>
      <div className="modal-content cancel-modal-content">
        <h2>Cancel Downloads?</h2>
        <p>
          You have <span style={{ color: '#4cd0c1', fontWeight: 'bold' }}>{remainingCount}</span>{' '}
          downloads remaining. Are you sure you want to cancel?
        </p>
        <div className="modal-buttons">
          <button id="confirm-cancel-btn" onClick={handleConfirm}>Yes, Cancel</button>
          <button id="dismiss-cancel-btn" onClick={closeCancelModal}>No, Continue</button>
        </div>
      </div>
    </div>
  );
}
