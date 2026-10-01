/** Warning shown before logout while scans are still queued on this device (null = no warning needed). */
export function pendingLogoutMessage(pending: number): string | null {
  if (pending <= 0) return null;
  return pending === 1
    ? "Existe 1 leitura ainda não sincronizada."
    : `Existem ${pending} leituras ainda não sincronizadas.`;
}
