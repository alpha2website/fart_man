'use client';

// ============================================================
// FART MAN — FaceCropEditor
// Uses react-easy-crop for in-browser face cropping.
// Photo never leaves the browser.
// ============================================================

import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';

interface FaceCropEditorProps {
  imageSrc: string;
  onConfirm: (croppedImage: HTMLImageElement) => void;
  onCancel: () => void;
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 96;  // smaller = faster network transfer for multiplayer
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      // Clip to circle
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();

      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        size,
        size,
      );

      // Use JPEG at 0.8 quality — much smaller than PNG for photos
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const resultImg = new Image();
      resultImg.onload = () => resolve(resultImg);
      resultImg.onerror = reject;
      resultImg.src = dataUrl;
    };
    image.onerror = reject;
    image.src = imageSrc;
  });
}

export default function FaceCropEditor({ imageSrc, onConfirm, onCancel }: FaceCropEditorProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [loading, setLoading] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;
    setLoading(true);
    try {
      const img = await getCroppedImg(imageSrc, croppedAreaPixels);
      onConfirm(img);
    } catch (e) {
      console.error('Crop failed', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="bg-gray-900 border border-yellow-400 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-yellow-400 to-orange-500 p-4 text-center">
          <h2 className="text-xl font-black text-black">🎭 PUT YOUR FACE ON FART MAN!</h2>
          <p className="text-xs text-black/70 mt-1">Drag, pinch & zoom to position your face</p>
        </div>

        {/* Cropper */}
        <div className="relative bg-gray-800" style={{ height: '280px' }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Zoom slider */}
        <div className="px-6 py-3 bg-gray-900">
          <label className="text-yellow-400 text-xs font-bold block mb-1">
            🔍 ZOOM: {zoom.toFixed(1)}×
          </label>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-yellow-400"
          />
        </div>

        {/* Privacy notice */}
        <p className="text-center text-gray-500 text-xs px-4 pb-2">
          🔒 Your photo stays in your browser only. Never uploaded anywhere.
        </p>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-3 p-4 bg-gray-900">
          <button
            onClick={onCancel}
            className="py-3 px-4 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="py-3 px-4 rounded-xl bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-black font-black transition-all disabled:opacity-60"
          >
            {loading ? 'Processing…' : '✅ Confirm!'}
          </button>
        </div>
      </div>
    </div>
  );
}
