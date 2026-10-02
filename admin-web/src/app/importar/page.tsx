"use client";

import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { Importer } from "@/components/importer";
import { Shell } from "@/components/ui";

export default function ImportPage() {
  return (
    <Shell title="Importar NF-e" description="A carga vem do texto “Carga:” das informações adicionais de cada NF-e. Reimportar o mesmo XML não duplica nada.">
      <Link
        href="/programacoes"
        className="mb-4 flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950 hover:border-orange-300"
      >
        <CalendarDays className="size-5 shrink-0 text-orange-700" aria-hidden />
        <span>
          Para a produção do dia, importe dentro de uma <b>programação de cargas</b>: o estoque coletado passa a valer para as cargas daquela programação.
          Aqui, as cargas ficam fora de qualquer programação (estoque geral).
        </span>
      </Link>
      <Importer endpoint="/api/import/xml" allowRar={false}
                loadsLink={<Link className="font-semibold text-orange-700 hover:underline" href="/cargas">Ver cargas</Link>} />
    </Shell>
  );
}
