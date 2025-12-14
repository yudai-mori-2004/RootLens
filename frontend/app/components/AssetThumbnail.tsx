'use client';

import { useState } from 'react';
import { ImageIcon } from 'lucide-react';

interface AssetThumbnailProps {
  src?: string | null;
  alt: string;
  className?: string;
}

export default function AssetThumbnail({ src, alt, className = '' }: AssetThumbnailProps) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className={`flex flex-col items-center justify-center w-full h-full text-slate-400 bg-slate-50 p-4 ${className}`}>
        <ImageIcon className="w-10 h-10 mb-2 opacity-50" />
        <span className="text-xs font-medium text-slate-500">プレビューなし</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setHasError(true)}
    />
  );
}
