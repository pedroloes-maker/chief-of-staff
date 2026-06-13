import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Calendar, Check, HardDrive, Mail, Plug, X } from "lucide-react";
import {
  useApi,
  type GoogleCatalogue,
  type GoogleService,
  type GoogleStatus,
} from "../lib/api";

const SERVICE_META: Record<
  GoogleService,
  { title: string; icon: typeof Mail; blurb: string }
> = {
  gmail: { title: "Gmail", icon: Mail, blurb: "Ler, rascunhar e enviar e-mails." },
  drive: { title: "Google Drive", icon: HardDrive, blurb: "Acessar e criar arquivos." },
  calendar: {
    title: "Google Calendar",
    icon: Calendar,
    blurb: "Consultar e gerenciar eventos.",
  },
};

export default function ConnectionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const api = useApi();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [catalogue, setCatalogue] = useState<GoogleCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<GoogleService | null>(null);
  // nível escolhido por serviço (default = primeiro nível do catálogo).
  const [levels, setLevels] = useState<Partial<Record<GoogleService, string>>>({});

  const refetch = useCallback(() => {
    if (!slug) return;
    api
      .googleStatus(slug)
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, slug]);

  useEffect(() => {
    setStatus(null);
    setError(null);
    refetch();
    api.googleCatalogue().then(setCatalogue).catch(() => {});
  }, [refetch, api]);

  // O callback do OAuth abre num popup e manda postMessage ao concluir.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === "connections:google:complete") {
        refetch();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [refetch]);

  const levelsByService = useMemo(() => {
    const m = new Map<GoogleService, GoogleCatalogue["services"][number]["levels"]>();
    catalogue?.services.forEach((s) => m.set(s.service, s.levels));
    return m;
  }, [catalogue]);

  const connect = async (service: GoogleService) => {
    if (!slug) return;
    const lvls = levelsByService.get(service);
    const level = levels[service] ?? lvls?.[0]?.id ?? "read";
    setBusy(service);
    setError(null);
    try {
      const { authUrl } = await api.startGoogleConnect(slug, service, level);
      window.open(authUrl, "_blank", "width=520,height=640");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (service: GoogleService) => {
    if (!slug) return;
    setBusy(service);
    setError(null);
    try {
      await api.disconnectGoogle(slug, service);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-10 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        Workspace · {slug}
      </p>
      <h1 className="mt-1 mb-2 text-[28px] font-semibold tracking-tight text-fg">
        Conexões
      </h1>
      <p className="mb-8 max-w-2xl text-sm text-fg-muted">
        Conecte as contas Google do executivo. O acesso é autorizado pelo próprio
        usuário no Google e guardado no cofre da Anthropic — o agente usa via MCP.
      </p>

      {error && (
        <div className="mb-5 rounded-card border border-line bg-surface p-4 text-sm text-fg shadow-card">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {(["gmail", "drive", "calendar"] as GoogleService[]).map((service) => {
          const meta = SERVICE_META[service];
          const st = status?.services.find((s) => s.service === service);
          const lvls = levelsByService.get(service) ?? [];
          const selected = levels[service] ?? st?.level ?? lvls[0]?.id ?? "";
          const Icon = meta.icon;
          return (
            <div
              key={service}
              className="rounded-card border border-line bg-surface p-6 shadow-card"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-elev">
                    <Icon className="h-5 w-5 text-fg" strokeWidth={1.5} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-fg">{meta.title}</h2>
                      {st?.connected ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-elev px-2 py-0.5 text-[11px] text-fg-muted">
                          <Check className="h-3 w-3" strokeWidth={2} /> Conectado
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-faint">
                          Desconectado
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-fg-muted">{meta.blurb}</p>
                    {st?.connected && st.email && (
                      <p className="mt-1 font-mono text-[11px] text-fg-faint">
                        {st.email}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {!st?.configured ? (
                <p className="mt-4 rounded-xl border border-dashed border-black/[0.12] bg-elev px-4 py-2.5 text-[13px] text-fg-muted">
                  Não configurado — defina <span className="font-mono">{service.toUpperCase()}_MCP_URL</span>{" "}
                  no <span className="font-mono">.env</span> (host público).
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
                      Nível de permissão
                    </span>
                    <select
                      value={selected}
                      onChange={(e) =>
                        setLevels((p) => ({ ...p, [service]: e.target.value }))
                      }
                      className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg shadow-card outline-none transition focus:border-line-strong"
                    >
                      {lvls.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() => connect(service)}
                    disabled={busy === service}
                    className="inline-flex items-center gap-2 rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg shadow-card transition hover:bg-black active:scale-[0.98] disabled:opacity-50"
                  >
                    <Plug className="h-4 w-4" strokeWidth={1.5} />
                    {st?.connected ? "Reconectar" : "Conectar"}
                  </button>
                  {st?.connected && (
                    <button
                      onClick={() => disconnect(service)}
                      disabled={busy === service}
                      className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg transition hover:bg-elev disabled:opacity-50"
                    >
                      <X className="h-4 w-4" strokeWidth={1.5} />
                      Desconectar
                    </button>
                  )}
                  {st?.connected && st.level && (
                    <span className="text-[11px] text-fg-faint">
                      nível atual: {st.level}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
