"use client";

import { useState } from "react";
import type { Media } from "@/lib/api/types";

export function VideoPlayer({ video, title }: { video: Media; title: string }) {
  const [failed, setFailed] = useState(false);
  const src = video.variants.mp4;
  return (
    <div className="overflow-hidden rounded-lg border-2 border-line bg-bark-950">
      {src && !failed ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- creator trailers have no caption tracks (v1)
        <video
          controls
          preload="metadata"
          poster={video.variants.poster}
          className="aspect-video w-full"
          aria-label={`${title} trailer`}
          onError={() => setFailed(true)}
        >
          <source src={src} type="video/mp4" />
        </video>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <div className="relative aspect-video">
          {video.variants.poster && <img src={video.variants.poster} alt={`${title} trailer poster`} className="h-full w-full object-cover" />}
          <p className="absolute inset-x-0 bottom-0 bg-bark-900 p-2 text-center text-sm text-comb-50">The trailer could not be loaded.</p>
        </div>
      )}
    </div>
  );
}
