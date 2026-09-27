import React from "react";

export function CarahueLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="28 27 387 102"
      role="img"
      aria-label="Carahue · Distribuidora de productos médicos"
    >
      <image href="/brand/carahue-source.jpeg" width="1036" height="1036" />
    </svg>
  );
}

export function CarahueWave({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 280 44"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M0 0H280V10C190 58 112 4 0 38Z" fill="#e2720e" />
      <path d="M0 0H280V1C190 47 112 -7 0 29Z" fill="white" />
    </svg>
  );
}
