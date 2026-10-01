"use client";

import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Optional camera reading. Results go to the SAME pipeline as the physical scanner (onDetected). */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

const WANTED_FORMATS = ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "itf", "upc_a", "upc_e",
                        "qr_code", "data_matrix"];

export function cameraSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

/** Same physical label in front of the lens is reported once per 2.5 s (the scan pipeline also guards). */
export function createCameraDebounce(windowMs = 2500) {
  let last = "";
  let at = 0;
  return (raw: string, now: number) => {
    if (raw === last && now - at < windowMs) return false;
    last = raw;
    at = now;
    return true;
  };
}

export function CameraScanner({
  onDetected,
  onClose,
  status,
}: {
  onDetected: (raw: string) => void;
  onClose: () => void;
  status: { label: string; tone: "ok" | "warn" | "bad" | "info" } | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string>("");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let zxingStop: (() => void) | null = null;
    const accept = createCameraDebounce();
    const emit = (raw: string) => {
      if (!stopped && raw && accept(raw, Date.now())) onDetectedRef.current(raw);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const video = videoRef.current;
        if (stopped || !video) return;
        video.srcObject = stream;
        await video.play();

        const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
        if (BD) {
          const supported = (await BD.getSupportedFormats?.()) ?? WANTED_FORMATS;
          const detector = new BD({ formats: WANTED_FORMATS.filter((f) => supported.includes(f)) });
          setEngine("nativo");
          const tick = async () => {
            if (stopped) return;
            try {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) emit(found[0].rawValue);
            } catch {
              /* frame not ready */
            }
            timer = setTimeout(tick, 150);
          };
          void tick();
        } else {
          // Lazy-loaded fallback: only downloaded when the camera is opened on browsers without BarcodeDetector.
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          setEngine("ZXing");
          const controls = await reader.decodeFromVideoElement(video, (result) => {
            if (result) emit(result.getText());
          });
          zxingStop = () => controls.stop();
          if (stopped) zxingStop();
        }
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setError(name === "NotAllowedError" ? "Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador."
          : name === "NotFoundError" ? "Nenhuma câmera encontrada neste dispositivo."
          : "Não foi possível abrir a câmera.");
      }
    })();

    // Never keep the camera running in the background.
    const onHidden = () => {
      if (document.visibilityState === "hidden") onClose();
    };
    document.addEventListener("visibilitychange", onHidden);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onHidden);
      if (timer) clearTimeout(timer);
      zxingStop?.();
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onClose]);

  const tone = status?.tone === "ok" ? "bg-green-700" : status?.tone === "warn" ? "bg-amber-400 text-slate-950"
    : status?.tone === "bad" ? "bg-red-700" : "bg-slate-800";

  return (
    <div role="dialog" aria-modal="true" aria-label="Leitura com câmera" className="fixed inset-0 z-40 flex flex-col bg-black text-white" data-no-refocus>
      <div className="flex items-center gap-2 px-3 py-2">
        <Camera className="size-5 text-orange-400" aria-hidden />
        <span className="text-sm font-bold tracking-wide">LER COM CÂMERA</span>
        {engine && <span className="text-xs text-slate-400">({engine})</span>}
        <button
          onClick={onClose}
          className="ml-auto inline-flex h-11 items-center gap-2 rounded-md bg-white px-4 text-sm font-bold text-slate-900 hover:bg-slate-200"
        >
          <X className="size-4" aria-hidden /> FECHAR CÂMERA
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />
        <div aria-hidden className="pointer-events-none absolute inset-x-[8%] top-1/2 h-[28%] -translate-y-1/2 rounded-lg border-4 border-orange-500/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        {error && (
          <div className="absolute inset-x-4 top-4 rounded-md bg-red-700 px-4 py-3 text-sm font-semibold">{error}</div>
        )}
      </div>
      <div className={`px-4 py-3 text-center text-lg font-bold ${status ? tone : "bg-slate-900 text-slate-300"}`} role="status" aria-live="polite">
        {status ? status.label : "Aponte a câmera para o código de barras"}
      </div>
    </div>
  );
}
