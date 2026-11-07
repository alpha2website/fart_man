'use client';

// ============================================================
// FART MAN — FaceUploader
// Handles file selection + camera capture, then launches crop editor.
// All data stays in browser memory only.
// ============================================================

import { useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const FaceCropEditor = dynamic(() => import('./FaceCropEditor'), { ssr: false });

interface FaceUploaderProps {
  currentFace: HTMLImageElement | null;
  onFaceConfirmed: (img: HTMLImageElement) => void;
  onRemoveFace: () => void;
  onClose: () => void;
}

export default function FaceUploader({
  currentFace,
  onFaceConfirmed,
  onRemoveFace,
  onClose,
}: FaceUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load image from file
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Please select a JPG, PNG, or WebP image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setRawImageSrc(ev.target?.result as string);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  // Open camera
  const openCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
      });
      setCameraStream(stream);
      setCameraActive(true);
      // Give the video ref time to mount
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      setError('Camera access denied. Please allow camera permissions or upload a photo.');
    }
  }, []);

  // Capture frame from camera
  const captureCamera = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 640;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    setRawImageSrc(canvas.toDataURL('image/png'));
    stopCamera();
  }, []);

  const stopCamera = useCallback(() => {
    cameraStream?.getTracks().forEach((t) => t.stop());
    setCameraStream(null);
    setCameraActive(false);
  }, [cameraStream]);

  const handleCropConfirm = (img: HTMLImageElement) => {
    // Revoke object URL to free memory
    if (rawImageSrc?.startsWith('blob:')) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc(null);
    onFaceConfirmed(img);
  };

  const handleCropCancel = () => {
    if (rawImageSrc?.startsWith('blob:')) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc(null);
  };

  const handleRemove = () => {
    onRemoveFace();
  };

  // If we have a raw image, show the crop editor
  if (rawImageSrc) {
    return (
      <FaceCropEditor
        imageSrc={rawImageSrc}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="bg-gray-900 border border-yellow-400 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-yellow-400 to-orange-500 p-4 text-center">
          <h2 className="text-xl font-black text-black">🎭 CUSTOMIZE YOUR FACE</h2>
          <p className="text-xs text-black/70 mt-1">Make Fart Man look like YOU!</p>
        </div>

        <div className="p-6 space-y-4">

          {/* Current face preview */}
          {currentFace && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-yellow-400 text-xs font-bold">CURRENT FACE:</p>
              <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-yellow-400 shadow-lg shadow-yellow-400/30">
                <img
                  src={currentFace.src}
                  alt="Current face"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}

          {/* Camera view */}
          {cameraActive && (
            <div className="flex flex-col items-center gap-3">
              <video
                ref={videoRef}
                muted
                playsInline
                className="rounded-xl w-full max-h-48 object-cover border-2 border-yellow-400"
              />
              <div className="flex gap-3 w-full">
                <button
                  onClick={stopCamera}
                  className="flex-1 py-2 rounded-xl bg-gray-700 text-white font-bold text-sm hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={captureCamera}
                  className="flex-1 py-2 rounded-xl bg-yellow-400 text-black font-black text-sm hover:bg-yellow-300 transition-colors"
                >
                  📸 Capture
                </button>
              </div>
            </div>
          )}

          {/* Upload options */}
          {!cameraActive && (
            <div className="space-y-3">
              {/* Upload from device */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center justify-center gap-2 transition-colors"
              >
                📁 Upload Photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Camera capture */}
              {'mediaDevices' in navigator && (
                <button
                  onClick={openCamera}
                  className="w-full py-3 px-4 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  📷 Use Camera
                </button>
              )}

              {/* Remove face */}
              {currentFace && (
                <button
                  onClick={handleRemove}
                  className="w-full py-3 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  🗑️ Remove My Face
                </button>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-red-400 text-sm text-center bg-red-900/30 rounded-lg p-2">{error}</p>
          )}

          {/* Privacy */}
          <p className="text-gray-500 text-xs text-center">
            🔒 Photos are processed in your browser only. Never stored or uploaded.
          </p>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 p-4">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold transition-colors"
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}
