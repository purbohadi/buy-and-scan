import { useRef, useState } from 'react';
import {
  ArrowClockwise,
  Camera,
  CheckCircle,
  Image,
  UploadSimple,
} from '@phosphor-icons/react';
import { Spinner } from './Spinner';

type Props = {
  file: File | null;
  previewUrl: string | null;
  busy: boolean;
  parsing: boolean;
  enabled: boolean;
  reviewed: boolean;
  onPickFile: (file: File) => void;
  onParse: () => void;
  onReset: () => void;
};

export function ReceiptCapture({
  file,
  previewUrl,
  busy,
  parsing,
  enabled,
  reviewed,
  onPickFile,
  onParse,
  onReset,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = (input: HTMLInputElement) => {
    const next = input.files?.[0];
    input.value = '';
    if (next) onPickFile(next);
  };

  return (
    <section className="capture-panel" aria-labelledby="capture-heading">
      <div className="panel-heading">
        <div className="step-heading">
          <span className="step-number">1</span>
          <h2 id="capture-heading">Capture</h2>
        </div>
        {file ? (
          <button
            className="btn btn-quiet btn-small"
            type="button"
            disabled={busy}
            onClick={onReset}
          >
            <ArrowClockwise size={16} aria-hidden="true" /> Reset
          </button>
        ) : null}
      </div>
      <p className="panel-intro">
        A clear photo is all you need. Keep the whole receipt in frame.
      </p>
      <input
        ref={fileInput}
        className="sr-only"
        tabIndex={-1}
        type="file"
        accept="image/*"
        aria-label="Choose receipt image"
        disabled={busy || !enabled}
        onChange={(e) => pick(e.currentTarget)}
      />
      <input
        ref={cameraInput}
        className="sr-only"
        tabIndex={-1}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take receipt photo"
        disabled={busy || !enabled}
        onChange={(e) => pick(e.currentTarget)}
      />

      <div
        className={`capture-area ${file ? 'has-image' : ''} ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && enabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const next = e.dataTransfer.files[0];
          if (!busy && enabled && next) onPickFile(next);
        }}
      >
        {file && previewUrl ? (
          <img
            className="receipt-preview"
            src={previewUrl}
            alt="Receipt photo for review"
          />
        ) : (
          <div className="capture-empty">
            <span className="capture-icon">
              <UploadSimple size={35} weight="light" aria-hidden="true" />
            </span>
            <h3>Add your receipt</h3>
            <p>Drop an image here, or choose a photo from your device.</p>
            <button
              type="button"
              className="btn"
              disabled={busy || !enabled}
              onClick={() => fileInput.current?.click()}
            >
              <Image size={19} aria-hidden="true" /> Choose image
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy || !enabled}
              onClick={() => cameraInput.current?.click()}
            >
              <Camera size={19} aria-hidden="true" /> Take a photo
            </button>
            <span className="file-hint">JPEG or PNG works best</span>
          </div>
        )}
        {parsing ? (
          <div className="image-processing">
            <Spinner /> Reading receipt
          </div>
        ) : null}
      </div>

      {file ? (
        <>
          <div className="file-details">
            <div>
              <span className="file-name" title={file.name}>
                {file.name}
              </span>
              <span className="file-hint">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-small"
              disabled={busy || !enabled}
              onClick={() => fileInput.current?.click()}
            >
              Change
            </button>
          </div>
          <button
            type="button"
            className="btn btn-block"
            disabled={busy || !enabled}
            onClick={onParse}
          >
            {parsing ? (
              <Spinner />
            ) : reviewed ? (
              <CheckCircle size={20} aria-hidden="true" />
            ) : (
              <Image size={20} aria-hidden="true" />
            )}
            {parsing
              ? 'Parsing receipt...'
              : reviewed
                ? 'Parse again'
                : 'Parse with AI'}
          </button>
        </>
      ) : null}
      {!enabled ? (
        <p className="capture-note">
          Connect Google Drive &amp; Sheets above to start scanning.
        </p>
      ) : (
        <p className="capture-note">
          You review and approve every result before it is saved.
        </p>
      )}
    </section>
  );
}
